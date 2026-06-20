import { promises as fs } from 'fs';
import { resolve } from 'path';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { scrapeState } from './scrapeState';
import {
  getUnanalyzedReviews,
  saveAnalyzedReview,
  getAllRawReviews,
  getAllAnalyzedReviews,
  updateAnalyzedReviewPainPoint,
} from './reviewService';
import { callGroqAPI, isGroqRateLimited, isAnyLLMAvailable } from '../lib/groqClient';
import { isGeminiRateLimited } from '../lib/geminiClient';
import { analyzeReviewSystemPrompt } from '../prompts/analyzeReviewPrompt';
import {
  POOR_QUALITY_FALLBACK,
  POOR_QUALITY_SUB_REASONS,
  OTHER_UNSPECIFIED,
  RECLASSIFY_SOURCE_BUCKETS,
  PoorQualitySubReason,
  refinePoorQualitySystemPrompt,
} from '../prompts/refinePoorQualityPrompt';
import { AnalysisSummary } from '../types/analysis';

export async function analyzePendingReviews(): Promise<number> {
  const pendingReviews = await getUnanalyzedReviews();
  let count = 0;
  const failedReviewIds: string[] = [];

  console.log(`Found ${pendingReviews.length} unanalyzed reviews. Starting Groq analysis...`);

  const batchSize = 5;
  const batches = chunkArray(pendingReviews, batchSize);

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const batchPromises = batch.map(async (review) => {
      try {
        const responseText = await callGroqAPI(
          `Review source: ${review.platform}\n\nReview Text:\n${review.review_text}`,
          analyzeReviewSystemPrompt
        );

        let analyzedData: any;
        try {
          analyzedData = JSON.parse(responseText);
        } catch (parseError) {
          console.error(`[Review ID: ${review.id}] Failed to parse JSON response:`, responseText);
          failedReviewIds.push(review.id);
          return null;
        }

        if (!validateAnalyzedReview(analyzedData)) {
          console.error(`[Review ID: ${review.id}] Invalid JSON schema structure:`, analyzedData);
          failedReviewIds.push(review.id);
          return null;
        }

        await saveAnalyzedReview({
          raw_review_id: review.id,
          pain_point: analyzedData.pain_point,
          discovery_behavior: analyzedData.discovery_behavior,
          user_need: analyzedData.user_need,
          sentiment: analyzedData.sentiment,
          theme: analyzedData.theme,
          summary: analyzedData.summary,
          confidence: analyzedData.confidence,
        });

        return review.id;
      } catch (error) {
        console.error(`[Review ID: ${review.id}] Groq review analysis failed:`, error);
        failedReviewIds.push(review.id);
        return null;
      }
    });

    const results = await Promise.all(batchPromises);
    const batchSuccessCount = results.filter(id => id !== null).length;
    count += batchSuccessCount;

    console.log(`  Batch ${batchIndex + 1}/${batches.length}: ${batchSuccessCount}/${batch.length} analyzed (total: ${count})`);

    if (batchIndex < batches.length - 1 && !isGroqRateLimited()) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  if (failedReviewIds.length > 0) {
    console.warn(`\nAnalysis complete. ${failedReviewIds.length} failed review IDs logged.`);
  }

  const refinedCount = await reclassifyPoorQualityFallbackReviews();
  if (refinedCount > 0) {
    console.log(`\nSecond-pass refinement: ${refinedCount} "${POOR_QUALITY_FALLBACK}" reviews reclassified.`);
  }

  return count;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mock-classifier fingerprints:
// The local mock always writes a fixed user_need string.  The second-pass only
// updates pain_point + confidence, never user_need — so user_need is the only
// reliable fingerprint after the second-pass has already run.
// ──────────────────────────────────────────────────────────────────────────────
const MOCK_USER_NEEDS = new Set([
  'More accurate and high-quality recommendation algorithms.',
  'Greater variety and freshness in music suggestions.',
  'New tools and options to search and filter discoveries.',
  'Truly fresh and obscure music recommendations in weekly discovery.',
  'A more random or customized shuffle feature.',
  'Unique Daily Mixes with less overlap and higher track variety.',
  'Fine-grained controls (like obscurity sliders) to tweak the recommendation engine.',
  'Accurate and comprehensive tracking of new music from followed indie artists.',
  'Radios that branch out and discover similar but unfamiliar artists.',
  'Option to hide or separate podcast recommendations.',
  'Better visibility and recommendations of lesser-known indie artists.',
  'More diverse autoplay that explores outside recent history.',
  "A 'dislike' or 'block' button to train the algorithm.",
  'Separation between liked songs and new discovery streams.',
  'Incognito listening mode or ability to reset taste profile.',
  'Accurate genre and mood categorization in auto-generated mixes.',
  'Algorithm that bridges genres and breaks out of bubbles.',
  "Context-aware recommendations that fit the playlist's mood.",
  // NOT including 'not_relevant': Groq also writes this legitimately, and the
  // second-pass already corrected those mock ones (confidence flipped to 'high')
]);

export async function reanalyzeMockClassifiedReviews(): Promise<number> {
  const [analyzedReviews, rawReviews] = await Promise.all([
    getAllAnalyzedReviews(),
    getAllRawReviews(),
  ]);

  const rawById = new Map(rawReviews.map(r => [r.id, r]));

  // Identify reviews classified by the mock analyzer:
  // - The second-pass only updates pain_point + confidence, never user_need.
  // - Mock user_need strings are unique (Groq varies them per review).
  // - For not_relevant user_need, second-pass already set confidence to 'high',
  //   so requiring confidence='medium' safely excludes those already-fixed rows.
  const mockReviews = analyzedReviews.filter(ar => {
    if (ar.confidence?.toLowerCase() !== 'medium') return false;
    if (!ar.user_need) return false;
    return MOCK_USER_NEEDS.has(ar.user_need.trim());
  });

  const total = mockReviews.length;
  console.log(`\nFound ${total} reviews likely classified by the mock analyzer.`);

  if (total === 0) {
    console.log('Nothing to re-analyze.');
    return 0;
  }

  // Pre-flight: if both Groq and Gemini are exhausted, bail out immediately.
  // This prevents mock data from being written over the existing DB entries.
  if (!isAnyLLMAvailable()) {
    console.error('\n⛔ Both Groq and Gemini daily limits are exhausted. Cannot re-analyze.');
    console.error('   Wait for limits to reset (midnight UTC / 5:30 AM IST) then re-run.');
    return 0;
  }

  console.log('Re-running first-pass Groq analysis on these reviews...\n');

  let count = 0;
  const failedIds: string[] = [];

  // When Groq is available: parallel batches of 5 with 1.5s between batches (fast).
  // When Gemini is the fallback: process one at a time with 7s delay to stay under 10 RPM.
  const groqBatchSize = 5;

  let reviewIdx = 0;
  for (const ar of mockReviews) {
    reviewIdx++;
    const geminiMode = isGroqRateLimited();

    try {
      const raw = rawById.get(ar.raw_review_id);
      if (!raw) {
        console.error(`[${reviewIdx}/${total}] Missing raw review for analyzed_id ${ar.id}`);
        failedIds.push(ar.id);
        continue;
      }

      console.log(`[${reviewIdx}/${total}] Re-analyzing (${geminiMode ? 'Gemini' : 'Groq'}) raw_review_id: ${ar.raw_review_id}`);

      const responseText = await callGroqAPI(
        `Review source: ${raw.platform}\n\nReview Text:\n${raw.review_text}`,
        analyzeReviewSystemPrompt
      );

      let analyzedData: any;
      try {
        analyzedData = JSON.parse(responseText);
      } catch {
        console.error(`  ✗ JSON parse failed`);
        failedIds.push(ar.id);
        continue;
      }

      if (!validateAnalyzedReview(analyzedData)) {
        console.error(`  ✗ Invalid schema from LLM`);
        failedIds.push(ar.id);
        continue;
      }

      // Guard: if both LLMs are rate-limited, do NOT save mock data over existing records
      if (!isAnyLLMAvailable()) {
        console.warn(`  ⚠ All LLMs rate-limited — skipping save for review ${reviewIdx} to preserve existing DB state`);
        failedIds.push(ar.id);
        break;
      }

      await saveAnalyzedReview({
        raw_review_id: raw.id,
        pain_point: analyzedData.pain_point,
        discovery_behavior: analyzedData.discovery_behavior,
        user_need: analyzedData.user_need,
        sentiment: analyzedData.sentiment,
        theme: analyzedData.theme,
        summary: analyzedData.summary,
        confidence: analyzedData.confidence,
      });

      count++;

      if (reviewIdx % 10 === 0) {
        console.log(`  Progress: ${reviewIdx}/${total} processed, ${count} saved`);
      }
    } catch (err) {
      console.error(`  ✗ Error re-analyzing review ${reviewIdx}:`, err);
      failedIds.push(ar.id);
    }

    // Only abort if BOTH LLMs are exhausted
    if (!isAnyLLMAvailable()) {
      console.warn('\n⚠ All LLMs rate-limited. Stopping early.');
      break;
    }

    if (isGroqRateLimited() && !isGeminiRateLimited()) {
      console.log('  (Groq daily limit hit — continuing via Gemini)');
    }

    // Delay between iterations to respect Gemini's 10 RPM limit
    if (reviewIdx < total) {
      const isGeminiActive = isGroqRateLimited();
      if (isGeminiActive) {
        await new Promise(r => setTimeout(r, 7000));
      } else {
        await new Promise(r => setTimeout(r, 200));
      }
    }
  }

  if (failedIds.length > 0) {
    console.warn(`\nFailed to re-analyze ${failedIds.length} reviews.`);
  }

  console.log(`\nFirst-pass re-analysis complete. ${count} reviews updated.`);

  // Only run second-pass if at least one real LLM is still available
  if (!isAnyLLMAvailable()) {
    console.warn('\n⚠ All LLMs rate-limited during first-pass. Skipping second-pass to avoid writing mock data.');
    console.warn('   Re-run this script after the daily limits reset (midnight UTC / 5:30 AM IST).');
    return count;
  }

  // Run second-pass on any newly created fallbacks from this batch
  console.log('\nRunning second-pass refinement on new fallbacks...\n');
  const refined = await reclassifyPoorQualityFallbackReviews();
  console.log(`Second-pass complete. ${refined} additional reviews refined.`);

  return count;
}

export async function reclassifyPoorQualityFallbackReviews(): Promise<number> {
  const [analyzedReviews, rawReviews] = await Promise.all([
    getAllAnalyzedReviews(),
    getAllRawReviews(),
  ]);

  const rawById = new Map(rawReviews.map(review => [review.id, review]));
  const fallbackReviews = analyzedReviews.filter(review => {
    if (!review.pain_point) return false;

    // Include the original fallback categories
    if (review.pain_point === POOR_QUALITY_FALLBACK || review.pain_point === OTHER_UNSPECIFIED) {
      return true;
    }

    // Include the 6 specific sub-reasons
    const subReasons = [
      "Recommendations don't match my actual taste",
      "Recommendations feel random or low-effort",
      "Recommendations got worse over time",
      "Recommendations are too repetitive",
      "Recommendations are too mainstream/generic",
      "Not enough new artist discovery"
    ];
    if (subReasons.includes(review.pain_point)) {
      return true;
    }

    // Include the second-pass not_relevant reviews
    if (review.pain_point === 'not_relevant' && review.user_need !== 'not_relevant') {
      return true;
    }

    return false;
  });

  if (fallbackReviews.length === 0) {
    console.log(`No fallback or reclassified reviews to refine.`);
    return 0;
  }

  const total = fallbackReviews.length;
  console.log(`\nStarting second-pass refinement for ${total} reviews...`);

  let refinedCount = 0;
  const failedReviewIds: string[] = [];
  const newDistribution: Record<string, number> = {};

  let reviewIdx = 0;
  for (const analyzedReview of fallbackReviews) {
    reviewIdx++;
    const geminiMode = isGroqRateLimited();

    try {
      const rawReview = rawById.get(analyzedReview.raw_review_id);

      console.log(`Reclassifying review ${reviewIdx} of ${total} (${geminiMode ? 'Gemini' : 'Groq'}) (analyzed_id: ${analyzedReview.id})`);

      if (!rawReview) {
        console.error(`  ✗ Missing raw review ${analyzedReview.raw_review_id}`);
        failedReviewIds.push(analyzedReview.id);
        continue;
      }

      if (isClearlyNotRecommendationRelated(rawReview.review_text)) {
        console.log(`  → Skipping API: clearly not about recommendations → not_relevant`);
        await updateAnalyzedReviewPainPoint(analyzedReview.id, 'not_relevant', 'high');
        newDistribution['not_relevant'] = (newDistribution['not_relevant'] || 0) + 1;
        refinedCount++;
        continue;
      }

      // Guard: if both LLMs are rate-limited, do NOT save mock data / proceed
      if (!isAnyLLMAvailable()) {
        console.warn(`  ⚠ All LLMs rate-limited — skipping refinement for review ${reviewIdx}`);
        failedReviewIds.push(analyzedReview.id);
        break;
      }

      const responseText = await callGroqAPI(
        `Review source: ${rawReview.platform}\n\nReview Text:\n${rawReview.review_text}`,
        refinePoorQualitySystemPrompt
      );

      let refinedData: any;
      try {
        refinedData = JSON.parse(responseText);
      } catch (parseError) {
        console.error(`  ✗ Failed to parse refinement JSON:`, responseText);
        failedReviewIds.push(analyzedReview.id);
        continue;
      }

      refinedData.pain_point = normalizeSubReason(refinedData.pain_point);

      if (!validateRefinedPainPoint(refinedData)) {
        console.error(`  ✗ Invalid refinement response:`, refinedData);
        failedReviewIds.push(analyzedReview.id);
        continue;
      }

      await updateAnalyzedReviewPainPoint(
        analyzedReview.id,
        refinedData.pain_point,
        refinedData.confidence
      );

      newDistribution[refinedData.pain_point] = (newDistribution[refinedData.pain_point] || 0) + 1;
      refinedCount++;
    } catch (error) {
      console.error(`  ✗ Second-pass refinement failed for review ${reviewIdx}:`, error);
      failedReviewIds.push(analyzedReview.id);
    }

    if (!isAnyLLMAvailable()) {
      console.warn('\n⚠ All LLMs rate-limited. Stopping second-pass early.');
      break;
    }

    // Delay between iterations to respect Gemini's 10 RPM limit
    if (reviewIdx < total) {
      const isGeminiActive = isGroqRateLimited();
      if (isGeminiActive) {
        await new Promise(r => setTimeout(r, 7000));
      } else {
        await new Promise(r => setTimeout(r, 200));
      }
    }
  }

  if (failedReviewIds.length > 0) {
    console.warn(`\nSecond-pass refinement failed for ${failedReviewIds.length} reviews.`);
  }

  printSubReasonDistribution(newDistribution, refinedCount);

  return refinedCount;
}

export async function logOtherUnspecifiedSamples(sampleSize = 10): Promise<void> {
  const [analyzedReviews, rawReviews] = await Promise.all([
    getAllAnalyzedReviews(),
    getAllRawReviews(),
  ]);

  const rawById = new Map(rawReviews.map(review => [review.id, review]));
  const otherReviews = analyzedReviews.filter(r => r.pain_point === OTHER_UNSPECIFIED);

  console.log(`\nFound ${otherReviews.length} reviews classified as "${OTHER_UNSPECIFIED}"`);

  if (otherReviews.length === 0) {
    return;
  }

  const shuffled = [...otherReviews].sort(() => Math.random() - 0.5);
  const samples = shuffled.slice(0, Math.min(sampleSize, shuffled.length));

  console.log(`\n── Sample of ${samples.length} random "${OTHER_UNSPECIFIED}" reviews ──\n`);

  samples.forEach((review, idx) => {
    const raw = rawById.get(review.raw_review_id);
    const text = raw?.review_text ?? '(raw review not found)';
    const platform = raw?.platform ?? 'unknown';

    console.log(`--- Sample ${idx + 1} / ${samples.length} ---`);
    console.log(`Platform: ${platform}`);
    console.log(`Analyzed ID: ${review.id}`);
    console.log(`Raw text:\n${text}\n`);
  });
}

function printSubReasonDistribution(counts: Record<string, number>, total: number): void {
  console.log('\n══════════════════════════════════════════');
  console.log('  SECOND-PASS SUB-REASON DISTRIBUTION');
  console.log('══════════════════════════════════════════');

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  for (const [reason, count] of sorted) {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    console.log(`  ${reason}`);
    console.log(`    ${count} (${pct}%)`);
  }

  const otherCount = counts[OTHER_UNSPECIFIED] ?? 0;
  const notRelevantCount = counts['not_relevant'] ?? 0;
  const specificCount = total - otherCount - notRelevantCount;
  console.log('──────────────────────────────────────────');
  console.log(`  Specific sub-reasons: ${specificCount} (${total > 0 ? Math.round((specificCount / total) * 100) : 0}%)`);
  console.log(`  Other unspecified:    ${otherCount} (${total > 0 ? Math.round((otherCount / total) * 100) : 0}%)`);
  console.log(`  Not relevant:         ${notRelevantCount} (${total > 0 ? Math.round((notRelevantCount / total) * 100) : 0}%)`);
  console.log(`  Total reclassified:   ${total}`);
  console.log('══════════════════════════════════════════\n');
}

function isClearlyNotRecommendationRelated(text: string): boolean {
  const lower = text.toLowerCase();

  const recSignals = [
    'recommend', 'suggest', 'discover', 'algorithm', 'playlist',
    'daily mix', 'discover weekly', 'release radar', 'shuffle',
    'on repeat', 'radio', 'new music', 'new artist', 'echo chamber',
    'mainstream', 'repetit', 'same song', 'same artist', 'taste',
    'know me', 'wrapped', 'feed', 'autoplay', 'mix ',
  ];
  if (recSignals.some(signal => lower.includes(signal))) return false;

  const unrelatedSignals = [
    'premium', 'subscription', 'ads', 'advertisement', 'payment', 'billing',
    'crash', 'freeze', 'bug', 'login', 'password', 'popup', 'pop up',
    'lossless', 'region', 'country', 'download', 'offline', 'skip',
    'payday', 'brand new phone', 'without subscription', 'free version',
    'glitch', 'not working', 'does not work', 'doesnt work', 'wont work', 'won\'t work',
    'fix', 'update', 'slow', 'lag', 'battery', 'device', 'load', 'open',
    'screen', 'widget', 'ui', 'interface', 'layout', 'design', 'dark mode',
    'button', 'icon', 'font', 'crashed', 'crashing', 'buggy', 'error'
  ];
  if (unrelatedSignals.some(signal => lower.includes(signal))) return true;

  const isPositiveOnly =
    (lower.includes('love') || lower.includes('like') || lower.includes('great') || lower.includes('good') || lower.includes('better') || lower.includes('best') || lower.includes('awesome') || lower.includes('excellent') || lower.includes('amazing') || lower.includes('perfect')) &&
    !lower.includes('hate') &&
    !lower.includes('bad') &&
    !lower.includes('suck') &&
    !lower.includes('worst') &&
    !lower.includes('terrible') &&
    !lower.includes('annoying') &&
    !lower.includes('frustrat');

  return isPositiveOnly;
}

function normalizeSubReason(value: string): string {
  if (!value) return value;
  const trimmed = value.trim();
  const exact = POOR_QUALITY_SUB_REASONS.find(r => r === trimmed);
  if (exact) return exact;

  const lower = trimmed.toLowerCase();
  const fuzzyMap: Array<[string, PoorQualitySubReason]> = [
    ['match my taste', "Recommendations don't match my actual taste"],
    ["don't match", "Recommendations don't match my actual taste"],
    ['wrong genre', "Recommendations don't match my actual taste"],
    ['random', 'Recommendations feel random or low-effort'],
    ['low-effort', 'Recommendations feel random or low-effort'],
    ['low effort', 'Recommendations feel random or low-effort'],
    ['worse over time', 'Recommendations got worse over time'],
    ['got worse', 'Recommendations got worse over time'],
    ['used to be', 'Recommendations got worse over time'],
    ['repetitive', 'Recommendations are too repetitive'],
    ['too repetitive', 'Recommendations are too repetitive'],
    ['same song', 'Recommendations are too repetitive'],
    ['mainstream', 'Recommendations are too mainstream/generic'],
    ['too generic', 'Recommendations are too mainstream/generic'],
    ['new artist', 'Not enough new artist discovery'],
    ['artist discovery', 'Not enough new artist discovery'],
    ['other unspecified', OTHER_UNSPECIFIED],
  ];

  for (const [needle, label] of fuzzyMap) {
    if (lower.includes(needle)) return label;
  }

  return trimmed;
}

export async function generateAnalysisSummary(): Promise<AnalysisSummary> {
  const rawReviews = await getAllRawReviews();
  const analyzedReviews = await getAllAnalyzedReviews();

  const totalReviews = rawReviews.length;
  const totalAnalyzedReviews = analyzedReviews.length;

  const sources = {
    PlayStore: rawReviews.filter(r => r.platform.toLowerCase().includes('play store') || r.platform.toLowerCase().includes('android')).length,
    AppStore: rawReviews.filter(r => r.platform.toLowerCase().includes('app store') || r.platform.toLowerCase().includes('ios')).length,
    SpotifyCommunity: rawReviews.filter(r => {
      const platform = r.platform.toLowerCase();
      const source = (r.source || '').toLowerCase();
      return platform.includes('spotify community') || source.includes('spotify community');
    }).length,
  };

  const painPointCounts: Record<string, number> = {};
  const userNeedsCounts: Record<string, number> = {};
  const themeCounts: Record<string, number> = {};
  const behaviorCounts: Record<string, number> = {};

  const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };

  const isRelevant = (val: string) => val && val.toLowerCase() !== 'not relevant' && val.toLowerCase() !== 'not_relevant';

  analyzedReviews.forEach(ar => {
    if (isRelevant(ar.pain_point)) {
      painPointCounts[ar.pain_point] = (painPointCounts[ar.pain_point] || 0) + 1;
    }
    if (isRelevant(ar.user_need)) {
      userNeedsCounts[ar.user_need] = (userNeedsCounts[ar.user_need] || 0) + 1;
    }
    if (isRelevant(ar.theme)) {
      themeCounts[ar.theme] = (themeCounts[ar.theme] || 0) + 1;
    }
    if (isRelevant(ar.discovery_behavior)) {
      behaviorCounts[ar.discovery_behavior] = (behaviorCounts[ar.discovery_behavior] || 0) + 1;
    }
    if (ar.sentiment) {
      const s = ar.sentiment.toLowerCase();
      if (s === 'positive') sentimentCounts.positive++;
      else if (s === 'neutral') sentimentCounts.neutral++;
      else if (s === 'negative') sentimentCounts.negative++;
    }
  });

  const totalAnalyzed = Math.max(1, analyzedReviews.length);

  const getTopEntries = (counts: Record<string, number>, limit = 5) => {
    return Object.entries(counts)
      .map(([name, count]) => ({
        name,
        count,
        percentage: Math.round((count / totalAnalyzed) * 100)
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  };

  const topPainPoints = getTopEntries(painPointCounts);
  const topUserNeeds = getTopEntries(userNeedsCounts);
  const topThemes = getTopEntries(themeCounts);
  const topDiscoveryBehaviors = getTopEntries(behaviorCounts);

  const sentimentSplit = {
    positive: sentimentCounts.positive,
    neutral: sentimentCounts.neutral,
    negative: sentimentCounts.negative,
    positivePercentage: Math.round((sentimentCounts.positive / totalAnalyzed) * 100),
    neutralPercentage: Math.round((sentimentCounts.neutral / totalAnalyzed) * 100),
    negativePercentage: Math.round((sentimentCounts.negative / totalAnalyzed) * 100),
  };

  return {
    totalReviews,
    totalAnalyzedReviews,
    sources,
    topPainPoints,
    topUserNeeds,
    topThemes,
    topDiscoveryBehaviors,
    sentimentSplit
  };
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

function validateAnalyzedReview(data: any): boolean {
  if (!data || typeof data !== 'object') return false;

  const requiredKeys = ['pain_point', 'discovery_behavior', 'user_need', 'sentiment', 'theme', 'summary', 'confidence'];
  for (const key of requiredKeys) {
    if (!(key in data)) return false;
  }

  const validSentiments = ['positive', 'neutral', 'negative'];
  const validConfidences = ['high', 'medium', 'low'];

  if (!validSentiments.includes(String(data.sentiment).toLowerCase())) return false;
  if (!validConfidences.includes(String(data.confidence).toLowerCase())) return false;

  return true;
}

function validateRefinedPainPoint(data: any): data is { pain_point: PoorQualitySubReason; confidence: string } {
  if (!data || typeof data !== 'object') return false;
  if (!('pain_point' in data) || !('confidence' in data)) return false;

  const validConfidences = ['high', 'medium', 'low'];
  if (!validConfidences.includes(String(data.confidence).toLowerCase())) return false;
  if (!POOR_QUALITY_SUB_REASONS.includes(data.pain_point)) return false;

  return true;
}

export function passesLocalFilter(text: string): boolean {
  if (!text) return false;

  // 1. Exclude reviews with less than 20 characters
  const trimmed = text.trim();
  if (trimmed.length < 20) {
    return false;
  }

  // 2. Include only English language reviews
  // Strip emojis so they don't count towards non-English/non-ASCII characters
  const textWithoutEmojis = trimmed.replace(/\p{Emoji}/gu, '');
  if (textWithoutEmojis.length > 0) {
    const nonAsciiCount = (textWithoutEmojis.match(/[^\x00-\x7F]/g) || []).length;
    if (nonAsciiCount / textWithoutEmojis.length > 0.1) {
      return false;
    }
  }

  // Also check if it contains at least one common English word
  const commonEnglishWords = [
    'the', 'and', 'to', 'of', 'in', 'i', 'is', 'that', 'it', 'on', 'you', 'this',
    'for', 'but', 'with', 'my', 'song', 'music', 'app', 'spotify', 'like', 'good',
    'great', 'new', 'no', 'not', 'have', 'are', 'was', 'so', 'me', 'just', 'get'
  ];
  const words = trimmed.toLowerCase().split(/[^a-z]+/);
  const hasEnglishWord = words.some(word => commonEnglishWords.includes(word));
  if (!hasEnglishWord) {
    return false;
  }

  return true;
}

export async function reanalyzeReviewsFromFile(limit?: number): Promise<number> {
  const rawPath = resolve(process.cwd(), 'scraped_raw_reviews.json');
  const classifiedPath = resolve(process.cwd(), 'classified_reviews.json');

  let rawReviews: any[] = [];
  try {
    const rawData = await fs.readFile(rawPath, 'utf8');
    rawReviews = JSON.parse(rawData);
  } catch (err: any) {
    console.error(`Error reading ${rawPath}: ${err.message}`);
    return 0;
  }

  let classifiedReviews: any[] = [];
  try {
    const classifiedData = await fs.readFile(classifiedPath, 'utf8');
    classifiedReviews = JSON.parse(classifiedData);
  } catch (err) {
    // Doesn't exist or is invalid JSON
  }

  // Check if classifiedReviews contains items from a previous run
  const rawIds = new Set(rawReviews.map(r => r.external_id));
  const hasOldData = classifiedReviews.some(r => !rawIds.has(r.external_id));
  if (hasOldData) {
    console.log('[Classifier] classified_reviews.json contains stale data from a previous run. Starting fresh...');
    classifiedReviews = [];
  }

  const classifiedIds = new Set<string>(classifiedReviews.map(r => r.external_id));
  let pendingReviews = rawReviews.filter(r => !classifiedIds.has(r.external_id));
  const initialPendingCount = pendingReviews.length;

  // Filter pending reviews locally first
  pendingReviews = pendingReviews.filter(r => passesLocalFilter(r.review_text));
  const filteredOutCount = initialPendingCount - pendingReviews.length;

  if (limit !== undefined && limit > 0) {
    pendingReviews = pendingReviews.slice(0, limit);
  }

  scrapeState.stage = 'classifying';
  scrapeState.totalPending = pendingReviews.length;
  scrapeState.classifiedCount = 0;

  console.log(`Loaded ${rawReviews.length} raw reviews from file.`);
  console.log(`Already classified: ${classifiedIds.size}.`);
  console.log(`Pending classification (after local filter): ${pendingReviews.length} (filtered out ${filteredOutCount} reviews).`);

  if (pendingReviews.length === 0) {
    console.log('No pending reviews to classify.');
    return 0;
  }

  // LLM rate-limited check bypassed to allow mock fallback

  let count = 0;
  let total = pendingReviews.length;

  for (const review of pendingReviews) {
    count++;
    scrapeState.classifiedCount = count;
    const geminiMode = isGroqRateLimited();

    // Batch delay to avoid Groq rate limit: wait 2 seconds every 10 reviews
    if (count > 0 && count % 10 === 0 && count < total && !geminiMode) {
      console.log(`[Classifier] Processed ${count}/${total} reviews. Waiting 2 seconds to avoid Groq rate limit...`);
      await new Promise(r => setTimeout(r, 2000));
    }

    console.log(`[${count}/${total}] Classifying (${geminiMode ? 'Gemini' : 'Groq'}) review: ${review.external_id}`);

    try {
      // 1. First-pass analysis
      const responseText = await callGroqAPI(
        `Review source: ${review.platform}\n\nReview Text:\n${review.review_text}`,
        analyzeReviewSystemPrompt
      );

      let analyzedData: any;
      try {
        analyzedData = JSON.parse(responseText);
      } catch {
        console.error(`  ✗ JSON parse failed`);
        continue;
      }

      if (!validateAnalyzedReview(analyzedData)) {
        console.error(`  ✗ Invalid first-pass schema`);
        continue;
      }

      // Check for second-pass fallback
      let isFallback = false;
      const subReasons = [
        "Recommendations don't match my actual taste",
        "Recommendations feel random or low-effort",
        "Recommendations got worse over time",
        "Recommendations are too repetitive",
        "Recommendations are too mainstream/generic",
        "Not enough new artist discovery"
      ];

      if (
        analyzedData.pain_point === POOR_QUALITY_FALLBACK ||
        analyzedData.pain_point === OTHER_UNSPECIFIED ||
        subReasons.includes(analyzedData.pain_point) ||
        (analyzedData.pain_point === 'not_relevant' && analyzedData.user_need !== 'not_relevant')
      ) {
        isFallback = true;
      }

      // 2. Second-pass refinement (if needed)
      if (isFallback) {
        if (isClearlyNotRecommendationRelated(review.review_text)) {
          console.log(`  → Skipping second-pass API: clearly not about recommendations → not_relevant`);
          analyzedData.pain_point = 'not_relevant';
          analyzedData.confidence = 'high';
        } else {
          // Add standard delay before second-pass call to protect Gemini limits if it's active
          if (isGroqRateLimited() && isAnyLLMAvailable()) {
            await new Promise(r => setTimeout(r, 7000));
          }

          console.log(`  → Running second-pass refinement...`);
          const secondPassResponse = await callGroqAPI(
            `Review source: ${review.platform}\n\nReview Text:\n${review.review_text}`,
            refinePoorQualitySystemPrompt
          );

          let refinedData: any;
          try {
            refinedData = JSON.parse(secondPassResponse);
            refinedData.pain_point = normalizeSubReason(refinedData.pain_point);
            if (validateRefinedPainPoint(refinedData)) {
              analyzedData.pain_point = refinedData.pain_point;
              analyzedData.confidence = refinedData.confidence;
              console.log(`  ✓ Refined to: ${analyzedData.pain_point}`);
            } else {
              console.warn(`  ⚠ Invalid second-pass response schema, keeping first-pass classification.`);
            }
          } catch {
            console.warn(`  ✗ Second-pass JSON parse failed, keeping first-pass classification.`);
          }
        }
      }

      // Save classification result progressively
      classifiedReviews.push({
        external_id: review.external_id,
        source: review.source,
        platform: review.platform,
        review_text: review.review_text,
        scraped_at: review.scraped_at,
        source_url: review.source_url,
        analysis: {
          pain_point: analyzedData.pain_point,
          discovery_behavior: analyzedData.discovery_behavior,
          user_need: analyzedData.user_need,
          sentiment: analyzedData.sentiment,
          theme: analyzedData.theme,
          summary: analyzedData.summary,
          confidence: analyzedData.confidence,
        }
      });

      // Write progress back to the file
      await fs.writeFile(classifiedPath, JSON.stringify(classifiedReviews, null, 2), 'utf8');

    } catch (err: any) {
      console.error(`  ✗ Error processing review ${review.external_id}: ${err.message}`);
    }

    // LLM rate-limited check bypassed to allow mock fallback

    // Delay between iterations to respect Gemini's rate limits
    if (count < total && isAnyLLMAvailable()) {
      const isGeminiActive = isGroqRateLimited();
      if (isGeminiActive) {
        await new Promise(r => setTimeout(r, 7000));
      } else {
        await new Promise(r => setTimeout(r, 200));
      }
    }
  }

  return count;
}

export async function importClassifiedReviews(): Promise<void> {
  const filePath = resolve(process.cwd(), 'classified_reviews.json');
  const rawFilePath = resolve(process.cwd(), 'scraped_raw_reviews.json');

  console.log(`[Importer] Reading classified reviews from ${filePath}...`);
  let classifiedReviews: any[] = [];
  try {
    const data = await fs.readFile(filePath, 'utf8');
    classifiedReviews = JSON.parse(data);
  } catch (err: any) {
    console.error(`[Importer] Error reading classified file: ${err.message}`);
  }

  console.log(`[Importer] Reading raw reviews from ${rawFilePath}...`);
  let rawReviews: any[] = [];
  try {
    const rawData = await fs.readFile(rawFilePath, 'utf8');
    rawReviews = JSON.parse(rawData);
  } catch (err: any) {
    console.error(`[Importer] Error reading raw reviews file: ${err.message}`);
  }

  // Fallback to classified reviews if raw reviews file is empty/missing
  if (rawReviews.length === 0) {
    console.log('[Importer] No raw reviews found in file, falling back to classified reviews...');
    rawReviews = classifiedReviews.map(r => ({
      external_id: r.external_id,
      source: r.source,
      platform: r.platform,
      review_text: r.review_text,
      scraped_at: r.scraped_at,
      source_url: r.source_url
    }));
  }

  // Clear the database tables completely so the dashboard only shows the new data
  console.log('[Importer] Clearing all existing reviews from Database to refresh dashboard with new data...');
  const { error: delAnalyzedErr } = await supabaseAdmin
    .from('analyzed_reviews')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (delAnalyzedErr) {
    console.error(`[Importer] Error clearing analyzed reviews: ${delAnalyzedErr.message}`);
  }

  const { error: delRawErr } = await supabaseAdmin
    .from('raw_reviews')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (delRawErr) {
    console.error(`[Importer] Error clearing raw reviews: ${delRawErr.message}`);
  }

  console.log(`[Importer] Found ${rawReviews.length} raw reviews and ${classifiedReviews.length} classified reviews in local files. Importing to Supabase...`);

  // Step 1: Upsert all raw reviews first to ensure they exist and get their database IDs.
  const rawReviewsData = rawReviews.map(r => ({
    external_id: r.external_id,
    source: r.source,
    platform: r.platform,
    review_text: r.review_text,
    scraped_at: r.scraped_at,
    source_url: r.source_url
  }));

  const BATCH_SIZE = 50;
  let rawInserted = 0;

  for (let i = 0; i < rawReviewsData.length; i += BATCH_SIZE) {
    const batch = rawReviewsData.slice(i, i + BATCH_SIZE);
    const { error, data } = await supabaseAdmin
      .from('raw_reviews')
      .upsert(batch, { onConflict: 'external_id', ignoreDuplicates: true })
      .select('id, external_id');

    if (error) {
      console.error(`[Importer] ✗ Error upserting raw reviews batch ${i}: ${error.message}`);
    } else {
      rawInserted += (data ?? []).length;
    }
  }
  console.log(`[Importer] ✓ Raw reviews upsert complete.`);

  // Step 2: Fetch all raw review IDs mapped by external_id
  const externalIds = rawReviews.map(r => r.external_id);
  const rawIdMap = new Map<string, string>();

  for (let i = 0; i < externalIds.length; i += 200) {
    const batchIds = externalIds.slice(i, i + 200);
    const { data, error } = await supabaseAdmin
      .from('raw_reviews')
      .select('id, external_id')
      .in('external_id', batchIds);

    if (error) {
      console.error(`[Importer] ✗ Error fetching raw reviews: ${error.message}`);
      return;
    }
    if (data) {
      for (const row of data) {
        rawIdMap.set(row.external_id, row.id);
      }
    }
  }

  // Step 3: Insert new analyzed reviews
  const analyzedReviewsData = classifiedReviews.map(r => {
    const rawId = rawIdMap.get(r.external_id);
    if (!rawId) return null;
    return {
      raw_review_id: rawId,
      pain_point: r.analysis.pain_point,
      discovery_behavior: r.analysis.discovery_behavior,
      user_need: r.analysis.user_need,
      sentiment: r.analysis.sentiment,
      theme: r.analysis.theme,
      summary: r.analysis.summary,
      confidence: r.analysis.confidence,
    };
  }).filter(Boolean);

  let insertedCount = 0;
  for (let i = 0; i < analyzedReviewsData.length; i += BATCH_SIZE) {
    const batch = analyzedReviewsData.slice(i, i + BATCH_SIZE);
    const { error, data } = await supabaseAdmin
      .from('analyzed_reviews')
      .insert(batch)
      .select('id');

    if (error) {
      console.error(`[Importer] ✗ Error inserting analyzed reviews batch: ${error.message}`);
    } else {
      insertedCount += (data ?? []).length;
    }
  }

  console.log(`\n==========================================`);
  console.log(`🎉 [Importer] IMPORT PIPELINE COMPLETE`);
  console.log(`- Raw reviews upserted:      ${rawReviewsData.length}`);
  console.log(`- New analyzed rows inserted: ${insertedCount}`);
  console.log(`==========================================\n`);
}
