import { getAllAnalyzedReviews, getAllRawReviews } from './reviewService';
import { callGroqAPI } from '../lib/groqClient';
import { normalizeSentimentFromText } from '../utils/sentiment';
import { askAnswerSystemPrompt } from '../prompts/askAnswerPrompt';
import { categorySelectionSystemPrompt } from '../prompts/categorySelectionPrompt';
import { AskQuestionResponse } from '../types/ask';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { RawReview, AnalyzedReview } from '../types/review';

function stem(word: string): string {
  let w = word.toLowerCase().trim();
  if (w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.endsWith('ing')) w = w.slice(0, -3);
  if (w.endsWith('ed')) w = w.slice(0, -2);
  if (w.endsWith('ive')) w = w.slice(0, -3) + 'e';
  if (w.endsWith('tion')) w = w.slice(0, -4);
  
  if (w.startsWith('repeti') || w.startsWith('repeat')) return 'repeat';
  if (w.startsWith('recommend')) return 'recommend';
  if (w.startsWith('discover')) return 'discover';
  if (w.startsWith('suggest')) return 'suggest';
  if (w.startsWith('playlist')) return 'playlist';
  if (w.startsWith('song') || w.startsWith('track')) return 'song';
  if (w.startsWith('algorithm')) return 'algorithm';
  if (w.startsWith('crea')) return 'creat';
  if (w.startsWith('podcast')) return 'podcast';
  
  return w;
}

function tokenize(text: string): string[] {
  if (!text) return [];
  const stopwords = new Set([
    'the', 'and', 'to', 'of', 'in', 'i', 'is', 'that', 'it', 'on', 'you', 'this',
    'for', 'but', 'with', 'a', 'an', 'or', 'about', 'why', 'do', 'are', 'what',
    'who', 'how', 'where', 'when', 'which', 'be', 'been', 'was', 'were', 'has',
    'have', 'had', 'does', 'did', 'feel', 'users', 'about', 'from', 'by', 'at',
    'keep', 'keeps', 'hear', 'hearing', 'listen', 'listening', 'get', 'gets', 'app', 'spotify', 'music'
  ]);
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(word => word.length > 1 && !stopwords.has(word))
    .map(stem);
}

function getTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }
  return tf;
}

interface ScoredReview {
  analyzed: AnalyzedReview;
  raw: RawReview | undefined;
  score: number;
}
interface CategoryCount {
  name: string;
  count: number;
}

interface CategoryInventory {
  painPoints: CategoryCount[];
  themes: CategoryCount[];
}

type CategoryIntent = 'narrow' | 'broad' | 'off_topic';

interface CategorySelection {
  intent: CategoryIntent;
  selected_pain_points: string[];
  selected_themes: string[];
  rationale: string;
}

interface CategoryRetrievedReview {
  analyzed: AnalyzedReview;
  raw: RawReview | undefined;
  category: string;
}

export interface AskDebugInfo {
  intent: CategoryIntent;
  selected_pain_points: string[];
  selected_themes: string[];
  rationale: string;
  category_counts: CategoryCount[];
  sampled_reviews: Array<{
    id: string;
    platform: string;
    pain_point: string | null;
    theme: string | null;
    text_preview: string;
  }>;
  generated_answer: string;
  generated_answer_points: string[];
}

const REDIRECT_ANSWER = "This is a research tool for analyzing Spotify user reviews about music discovery and recommendations, so I don't have the right review data to answer that. Try asking about recommendations, Smart Shuffle, Discover Weekly, podcasts, playlist discovery, or other Spotify discovery topics.";

function isRelevantCategory(value: string | null | undefined): value is string {
  return !!value && value.toLowerCase() !== 'not relevant' && value.toLowerCase() !== 'not_relevant';
}

function topCounts(counts: Record<string, number>): CategoryCount[] {
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function buildCategoryInventory(analyzedReviews: AnalyzedReview[]): CategoryInventory {
  const painPointCounts: Record<string, number> = {};
  const themeCounts: Record<string, number> = {};

  for (const review of analyzedReviews) {
    if (isRelevantCategory(review.pain_point)) {
      painPointCounts[review.pain_point] = (painPointCounts[review.pain_point] || 0) + 1;
    }
    if (isRelevantCategory(review.theme)) {
      themeCounts[review.theme] = (themeCounts[review.theme] || 0) + 1;
    }
  }

  return {
    painPoints: topCounts(painPointCounts),
    themes: topCounts(themeCounts),
  };
}

function parseJsonObject(raw: string): any | null {
  try {
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '').trim();
    }
    cleaned = cleaned.replace(/,(\s*[\]}])/g, '$1');
    return JSON.parse(cleaned);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0].replace(/,(\s*[\]}])/g, '$1'));
    } catch {
      return null;
    }
  }
}

function normalizeSelection(parsed: any, inventory: CategoryInventory): CategorySelection {
  const validPainPoints = new Set(inventory.painPoints.map(c => c.name));
  const validThemes = new Set(inventory.themes.map(c => c.name));
  const intent: CategoryIntent = parsed?.intent === 'narrow' || parsed?.intent === 'broad' || parsed?.intent === 'off_topic'
    ? parsed.intent
    : 'off_topic';

  const selectedPainPoints = Array.isArray(parsed?.selected_pain_points)
    ? parsed.selected_pain_points.filter((name: unknown): name is string => typeof name === 'string' && validPainPoints.has(name))
    : [];
  const selectedThemes = Array.isArray(parsed?.selected_themes)
    ? parsed.selected_themes.filter((name: unknown): name is string => typeof name === 'string' && validThemes.has(name))
    : [];

  return {
    intent,
    selected_pain_points: intent === 'off_topic' ? [] : selectedPainPoints,
    selected_themes: intent === 'off_topic' ? [] : selectedThemes,
    rationale: typeof parsed?.rationale === 'string' ? parsed.rationale.slice(0, 500) : '',
  };
}

function isClearlyOffTopic(question: string): boolean {
  const lower = question.toLowerCase().trim();
  
  // Truly off-topic keywords (e.g. weather, stocks, cooking/recipes, sports, bollywood)
  const offTopicKeywords = [
    'weather', 'stock market', 'stock price', 'sports score', 'cooking recipe', 
    'bollywood trivia', 'how to cook', 'recipe for', 'cricket score', 
    'football match', 'basketball game', 'who won the game', 'temperature today'
  ];
  
  if (offTopicKeywords.some(keyword => lower.includes(keyword))) {
    return true;
  }
  
  // If the query is completely unrelated to music/audio/Spotify and has no broad research terms
  const hasDiscoveryTerms = /spotify|music|song|track|artist|recommend|discovery|discover|playlist|shuffle|radio|podcast|mix|taste|vibe|weekly|daily|radar|dj/i.test(lower);
  const hasBroadResearchTerms = /frustration|pain\s*point|problem|complaint|issue|increasing|trend|rising|what\s*are\s*users\s*saying|what\s*do\s*users\s*want|opportunity|need|improve/i.test(lower);
  
  if (!hasDiscoveryTerms && !hasBroadResearchTerms) {
    return true;
  }
  
  return false;
}

function isBroadReviewResearchQuestion(question: string): boolean {
  const lower = question.toLowerCase();
  const asksAboutNeedsOrPatterns =
    lower.includes('unmet need') ||
    lower.includes('unmet needs') ||
    lower.includes('user needs') ||
    lower.includes('needs emerge') ||
    lower.includes('patterns') ||
    lower.includes('themes') ||
    lower.includes('trends') ||
    lower.includes('consistently') ||
    lower.includes('frustration') ||
    lower.includes('pain point') ||
    lower.includes('problem') ||
    lower.includes('complaint') ||
    lower.includes('issue') ||
    lower.includes('increasing') ||
    lower.includes('rising') ||
    lower.includes('what are users saying') ||
    lower.includes('what do users want') ||
    lower.includes('opportunity') ||
    lower.includes('needs') ||
    lower.includes('improve');
  const pointsAtReviewCorpus =
    lower.includes('review') ||
    lower.includes('reviews') ||
    lower.includes('users') ||
    lower.includes('feedback') ||
    lower.includes('spotify') ||
    lower.includes('discover') ||
    lower.includes('recommend');

  return asksAboutNeedsOrPatterns;
}

function broadSelectionFromInventory(inventory: CategoryInventory, rationale: string): CategorySelection {
  return {
    intent: 'broad',
    selected_pain_points: inventory.painPoints.map(c => c.name),
    selected_themes: [],
    rationale,
  };
}

function rationaleExplicitlySpotifyDiscoveryRelated(rationale: string): boolean {
  return /music|song|track|artist|recommend|discovery|discover|playlist|shuffle|radio|podcast|mix|taste|vibe/i.test(rationale);
}

export async function selectRelevantCategories(question: string, inventory: CategoryInventory): Promise<CategorySelection> {
  if (isClearlyOffTopic(question)) {
    return {
      intent: 'off_topic',
      selected_pain_points: [],
      selected_themes: [],
      rationale: 'The question is clearly off-topic and unrelated to Spotify music discovery or recommendations.'
    };
  }

  if (isBroadReviewResearchQuestion(question)) {
    return broadSelectionFromInventory(
      inventory,
      'The question is a broad Spotify discovery research or frustration question.'
    );
  }

  const prompt = `User question: "${question}"

Available pain point categories with counts:
${inventory.painPoints.map(c => `- ${c.name} (${c.count})`).join('\n')}

Available themes with counts:
${inventory.themes.map(c => `- ${c.name} (${c.count})`).join('\n')}`;

  try {
    const raw = await callGroqAPI(prompt, categorySelectionSystemPrompt);
    const parsed = parseJsonObject(raw);
    const selection = normalizeSelection(parsed, inventory);

    // Strict fallback: only recover from an empty category list when the selector's
    // own rationale explicitly says the question is Spotify/music-discovery-related.
    if (selection.intent !== 'off_topic' && selection.selected_pain_points.length === 0) {
      if (rationaleExplicitlySpotifyDiscoveryRelated(selection.rationale)) {
        return broadSelectionFromInventory(inventory, selection.rationale);
      }
      return { ...selection, intent: 'off_topic', selected_pain_points: [], selected_themes: [] };
    }

    if (selection.intent === 'off_topic' || selection.selected_pain_points.length === 0) {
      if (!isClearlyOffTopic(question)) {
        return broadSelectionFromInventory(inventory, 'Recovered from off_topic classification for a topic that is not clearly off-topic.');
      }
    }

    return selection;
  } catch (err: any) {
    console.warn('[askService] Failed to select categories:', err.message);
    if (!isClearlyOffTopic(question)) {
      return broadSelectionFromInventory(inventory, 'Category selection failed but query is relevant.');
    }
    return { intent: 'off_topic', selected_pain_points: [], selected_themes: [], rationale: 'Category selection failed.' };
  }
}

function compareReviewsForSampling(a: AnalyzedReview, b: AnalyzedReview): number {
  const sentimentRank = (sentiment: string | null) => sentiment?.toLowerCase() === 'negative' ? 0 : sentiment?.toLowerCase() === 'neutral' ? 1 : 2;
  const confidenceRank = (confidence: string | null) => confidence?.toLowerCase() === 'high' ? 0 : confidence?.toLowerCase() === 'medium' ? 1 : 2;
  return sentimentRank(a.sentiment) - sentimentRank(b.sentiment)
    || confidenceRank(a.confidence) - confidenceRank(b.confidence)
    || (a.created_at || '').localeCompare(b.created_at || '');
}

const PRIORITIZED_PAIN_POINTS = new Set([
  "Recommendations don't match my actual taste",
  "General repetitiveness in recommendations",
  "Recommendations are too repetitive",
  "Smart Shuffle forces the same popular songs",
  "Discover Weekly repeats songs I already know",
  "Daily Mixes have too much overlap or repeat tracks",
  "Radio stations recycle liked songs instead of finding new artists",
  "Podcasts clutter the music discovery feed",
  "Algorithm pushes mainstream tracks over organic discoveries",
  "Recommendations ignore my actual playlist vibe",
  "Lack of control over how adventurous recommendations are",
  "Release Radar misses indie artists I follow",
  "Recommendations got worse over time",
  "Temporary listening habits ruin taste profile"
]);

const PRIORITIZED_THEMES = new Set([
  "Recommendation Quality",
  "Repetitive Recommendations",
  "Smart Shuffle",
  "Discover Weekly",
  "Daily Mix",
  "Radio",
  "Podcast Clutter",
  "Mainstream Bias",
  "Playlist Discovery",
  "Mood Mismatch",
  "Taste Profile",
  "Artist Discovery Bias"
]);

export function retrieveReviewsByCategories(
  selection: CategorySelection,
  analyzedReviews: AnalyzedReview[],
  rawReviews: RawReview[],
  question: string,
  limit = selection.intent === 'broad' ? 36 : 12
): CategoryRetrievedReview[] {
  if (selection.intent === 'off_topic' || selection.selected_pain_points.length === 0) return [];

  const rawMap = new Map<string, RawReview>();
  for (const raw of rawReviews) rawMap.set(raw.id, raw);

  // Compute TF-IDF score map for the query
  const scoredList = retrieveRelevantReviews(question, analyzedReviews, rawReviews, analyzedReviews.length, selection.intent === 'broad');
  const scoreMap = new Map<string, number>();
  for (const item of scoredList) {
    scoreMap.set(item.analyzed.raw_review_id, item.score);
  }

  const selectedPainPoints = new Set(selection.selected_pain_points);
  const selectedThemes = new Set(selection.selected_themes);

  const isPositiveQuery = /like|love|good|great|positive|enjoy|best|favorite|benefit|pros|happy/i.test(question);

  const matched = analyzedReviews
    .filter(review => isRelevantCategory(review.pain_point))
    .filter(review => {
      const rawReview = rawMap.get(review.raw_review_id);
      const rawText = rawReview?.review_text || '';
      const dynamicSentiment = normalizeSentimentFromText(rawText, review.sentiment, rawReview?.rating);
      // Exclude positive reviews for negative/neutral frustration questions
      if (!isPositiveQuery && dynamicSentiment === 'positive') {
        return false;
      }
      return true;
    })
    .filter(review => {
      // Prioritize pain points if they are specified
      if (selectedPainPoints.size > 0) {
        return selectedPainPoints.has(review.pain_point || '');
      }
      return selectedThemes.has(review.theme || '');
    });

  const customCompare = (a: AnalyzedReview, b: AnalyzedReview) => {
    const scoreA = scoreMap.get(a.raw_review_id) || 0;
    const scoreB = scoreMap.get(b.raw_review_id) || 0;
    if (Math.abs(scoreA - scoreB) > 0.0001) {
      return scoreB - scoreA;
    }
    return compareReviewsForSampling(a, b);
  };

  if (selection.intent !== 'broad') {
    return matched
      .sort(customCompare)
      .slice(0, limit)
      .map(review => ({ analyzed: review, raw: rawMap.get(review.raw_review_id), category: review.pain_point || review.theme || 'Feedback' }));
  }

  const byCategory = new Map<string, AnalyzedReview[]>();
  for (const review of matched) {
    const category = review.pain_point || review.theme || 'Feedback';
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category)!.push(review);
  }

  const categoryOrder = selection.selected_pain_points.filter(category => byCategory.has(category));
  const perCategory = Math.max(1, Math.floor(limit / Math.max(1, categoryOrder.length)));
  const selected: AnalyzedReview[] = [];

  for (const category of categoryOrder) {
    selected.push(...byCategory.get(category)!.sort(customCompare).slice(0, perCategory));
  }

  let cursor = 0;
  while (selected.length < limit && categoryOrder.length > 0) {
    let added = false;
    for (const category of categoryOrder) {
      const reviews = byCategory.get(category)!.sort(customCompare);
      const next = reviews[perCategory + cursor];
      if (next && !selected.includes(next)) {
        selected.push(next);
        added = true;
        if (selected.length >= limit) break;
      }
    }
    if (!added) break;
    cursor++;
  }

  return selected.map(review => ({
    analyzed: review,
    raw: rawMap.get(review.raw_review_id),
    category: review.pain_point || review.theme || 'Feedback',
  }));
}

function getEmptySourceCounts() {
  return { PlayStore: 0, AppStore: 0, SpotifyCommunity: 0 };
}

function countSourcesForRetrieved(retrieved: CategoryRetrievedReview[]) {
  return {
    PlayStore: retrieved.filter(r => r.raw?.platform.toLowerCase().includes('play store') || r.raw?.platform.toLowerCase().includes('android')).length,
    AppStore: retrieved.filter(r => r.raw?.platform.toLowerCase().includes('app store') || r.raw?.platform.toLowerCase().includes('ios')).length,
    SpotifyCommunity: retrieved.filter(r => {
      const platform = r.raw?.platform.toLowerCase() || '';
      const source = r.raw?.source.toLowerCase() || '';
      return platform.includes('spotify community') || source.includes('spotify community');
    }).length,
  };
}


export function retrieveRelevantReviews(
  query: string,
  analyzedReviews: AnalyzedReview[],
  rawReviews: RawReview[],
  limit = 10,
  isBroad = false
): ScoredReview[] {
  // Build a lookup map for raw reviews by id for O(1) access
  const rawMap = new Map<string, RawReview>();
  for (const r of rawReviews) {
    rawMap.set(r.id, r);
  }

  // Exclude reviews where pain_point is "not_relevant"
  const candidates = analyzedReviews.filter(r => r.pain_point !== 'not_relevant');

  // Use ONLY the raw review_text for the TF-IDF document corpus.
  // The analyzed fields (pain_point, summary, theme) use identical boilerplate
  // per theme (e.g., every "Podcasts" review has the same pain_point text),
  // which defeats score discrimination. Raw text provides genuine variation
  // between reviews that merely mention a topic vs. those that are actually
  // about it.
  const docTexts = candidates.map(r => {
    const raw = rawMap.get(r.raw_review_id);
    return (raw?.review_text || '').trim();
  });

  const docTokens = docTexts.map(text => tokenize(text));
  const docCount = docTokens.length;

  const df = new Map<string, number>();
  for (const tokens of docTokens) {
    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      df.set(token, (df.get(token) || 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [word, count] of df.entries()) {
    idf.set(word, Math.log((1 + docCount) / (1 + count)) + 1);
  }

  const embed = (tokens: string[]): Map<string, number> => {
    const tf = getTF(tokens);
    const vector = new Map<string, number>();
    for (const [word, count] of tf.entries()) {
      const wordIdf = idf.get(word) || 1;
      vector.set(word, count * wordIdf);
    }
    return vector;
  };

  const queryTokens = tokenize(query);
  const queryVector = embed(queryTokens);

  const COMPLAINT_WORDS = new Set([
    'annoy', 'wrong', 'problem', 'issue', 'broke', 'broken', 'terribl', 'terrible', 'worst', 'bad', 'disappoint', 'frustrat', 'garbage', 'trash', 'hate', 'clutter'
  ]);
  const isComplaintQuery = queryTokens.some(t => COMPLAINT_WORDS.has(t));

  const TOPIC_TERMS = new Set([
    'podcast', 'playlist', 'shuffle', 'dj', 'ad', 'premium', 'song', 'artist', 'mix', 'widget', 'radar', 'recommend', 'discover', 'suggest', 'music'
  ]);
  const queryTopics = queryTokens.filter(t => TOPIC_TERMS.has(t));

  const scoredReviews: ScoredReview[] = candidates.map((r, index) => {
    const raw = rawMap.get(r.raw_review_id);
    const reviewTokens = docTokens[index];

    // If the query contains topic terms, the review must match at least one of them (except in broad queries)
    let topicMatch = true;
    if (!isBroad && queryTopics.length > 0) {
      topicMatch = reviewTokens.some(t => queryTopics.includes(t));
    }

    let score = 0;
    if (topicMatch) {
      const reviewVector = embed(reviewTokens);
      let dotProduct = 0;
      let normQuery = 0;
      let normReview = 0;

      for (const [word, qVal] of queryVector.entries()) {
        const rVal = reviewVector.get(word) || 0;
        dotProduct += qVal * rVal;
        normQuery += qVal * qVal;
      }

      for (const rVal of reviewVector.values()) {
        normReview += rVal * rVal;
      }

      score = (normQuery === 0 || normReview === 0) 
        ? 0 
        : dotProduct / (Math.sqrt(normQuery) * Math.sqrt(normReview));

      // Deboost positive reviews for complaint queries
      const isPositiveSentiment = r.sentiment?.toLowerCase() === 'positive' ||
        (r.sentiment?.toLowerCase() === 'neutral' && /\b(love|great|good|best|like|happy)\b/i.test(raw?.review_text || ''));
      if (isComplaintQuery && isPositiveSentiment) {
        score *= 0.5;
      }

      // Boost for prioritized themes/pain points
      const hasPrioritizedPainPoint = r.pain_point && PRIORITIZED_PAIN_POINTS.has(r.pain_point);
      const hasPrioritizedTheme = r.theme && PRIORITIZED_THEMES.has(r.theme);
      if (hasPrioritizedPainPoint || hasPrioritizedTheme) {
        score *= 1.5;
      }
    }

    return {
      analyzed: r,
      raw,
      score
    };
  });

  // Exclude reviews below similarity threshold
  const threshold = isBroad ? 0.05 : 0.28;
  const results = scoredReviews
    .filter(res => res.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Log scores for diagnostics
  console.log(`[retrieveRelevantReviews] query="${query}" | ${results.length} results above threshold ${threshold}`);
  results.forEach((r, i) => {
    console.log(`  #${i + 1} [score: ${r.score.toFixed(4)}] theme="${r.analyzed.theme}" text="${(r.raw?.review_text || '').slice(0, 80)}..."`);
  });

  return results;
}

export async function expandQuery(question: string): Promise<string> {
  // If it's a very short conversational phrase, skip expansion
  const conversationalWords = new Set(['hi', 'hello', 'hey', 'thanks', 'thank you', 'ok', 'cool']);
  if (conversationalWords.has(question.toLowerCase().trim())) {
    return '';
  }

  const prompt = `Expand this user search question into 5-8 related keywords, search terms, and synonyms that might appear in user reviews about this topic. Return only a comma-separated list of keywords.

User question: "${question}"`;

  const systemPrompt = "You are a query expansion assistant. Expand the user's question into 5 to 8 related keywords, synonyms, and search terms that are likely to appear in user feedback or App Store/Play Store reviews about this topic. Keep the output extremely simple: return ONLY a comma-separated list of the keywords. Do not include introductory text, explanations, numbering, or bullet points.";

  try {
    const response = await callGroqAPI(prompt, systemPrompt);
    return response.trim().replace(/^["']|["']$/g, '').trim();
  } catch (err: any) {
    console.warn('[askService] Failed to expand query:', err.message);
    return '';
  }
}

function checkConversationalPhrases(question: string): (AskQuestionResponse & { debug?: AskDebugInfo }) | null {
  const clean = question.trim().toLowerCase().replace(/[?!.,;:]/g, '').replace(/\s+/g, ' ');
  
  const greetings = new Set([
    'hi', 'hello', 'hey', 'greetings', 'yo', 'hola', 'howdy', 'sup',
    'hi there', 'hello there', 'hey there',
    'good morning', 'good afternoon', 'good evening',
    'how are you', 'how is it going', 'hows it going',
    'whats up', 'what is up', 'whats new', 'what is new',
    'hi discovery assistant', 'hello discovery assistant', 'hey discovery assistant'
  ]);

  const appreciation = new Set([
    'thanks', 'thank you', 'thank you so much', 'appreciate it', 'thanks dynamic assistant',
    'thanks assistant', 'thank you assistant'
  ]);

  const goodbyes = new Set([
    'bye', 'goodbye', 'see you', 'see you later', 'talk to you later', 'farewell'
  ]);

  if (greetings.has(clean)) {
    return {
      answer: "Hello! I am your Spotify Discovery Assistant. How can I help you analyze user reviews and feedback today?",
      answer_points: [],
      source_counts: getEmptySourceCounts(),
      supporting_reviews: [],
    };
  }

  if (appreciation.has(clean)) {
    return {
      answer: "You're very welcome! Let me know if you have any other questions or need further analysis on the Spotify reviews.",
      answer_points: [],
      source_counts: getEmptySourceCounts(),
      supporting_reviews: [],
    };
  }

  if (goodbyes.has(clean)) {
    return {
      answer: "Goodbye! Have a great day, and feel free to reach out whenever you want to analyze more reviews.",
      answer_points: [],
      source_counts: getEmptySourceCounts(),
      supporting_reviews: [],
    };
  }

  return null;
}

export async function answerQuestion(question: string): Promise<AskQuestionResponse & { debug?: AskDebugInfo }> {
  const conversational = checkConversationalPhrases(question);
  if (conversational) {
    await supabaseAdmin.from('question_logs').insert([{
      question,
      answer: conversational.answer,
      source_counts: conversational.source_counts,
      supporting_review_ids: []
    }]);
    return conversational;
  }

  const analyzedReviews = await getAllAnalyzedReviews();
  const rawReviews = await getAllRawReviews();
  const inventory = buildCategoryInventory(analyzedReviews);
  const selection = await selectRelevantCategories(question, inventory);

  console.log(`[askService] Question: "${question}"`);
  console.log(`[askService] Category Selection: ${JSON.stringify(selection)}`);

  const categoryCounts = inventory.painPoints.filter(c => selection.selected_pain_points.includes(c.name));

  if (selection.intent === 'off_topic' || selection.selected_pain_points.length === 0) {
    return {
      answer: REDIRECT_ANSWER,
      answer_points: [],
      source_counts: getEmptySourceCounts(),
      supporting_reviews: [],
      debug: {
        ...selection,
        category_counts: categoryCounts,
        sampled_reviews: [],
        generated_answer: REDIRECT_ANSWER,
        generated_answer_points: [],
      }
    };
  }

  let searchQuery = question;
  if (selection.intent === 'broad') {
    searchQuery = `${question} Spotify discovery pain points, recommendation frustrations, repetitive songs, stale recommendations, Smart Shuffle issues, Discover Weekly complaints, playlist discovery problems, mainstream recommendations, mood mismatch, podcast clutter.`;
  } else {
    const expanded = await expandQuery(question);
    if (expanded) {
      searchQuery = `${question}, ${expanded}`;
    }
  }

  const retrieved = retrieveReviewsByCategories(selection, analyzedReviews, rawReviews, searchQuery);

  if (retrieved.length === 0) {
    const answer = "I found a Spotify-related question, but I don't have enough classified review evidence in the current dataset to answer it reliably. Try asking about recommendations, Smart Shuffle, Discover Weekly, podcasts, playlist discovery, or other music discovery topics.";
    return {
      answer,
      answer_points: [],
      source_counts: getEmptySourceCounts(),
      supporting_reviews: [],
      debug: {
        ...selection,
        category_counts: categoryCounts,
        sampled_reviews: [],
        generated_answer: answer,
        generated_answer_points: [],
      }
    };
  }

  const reviewsContext = retrieved.map((r, index) => {
    return `[Review #${index + 1}]
Source: ${r.raw?.platform || 'Unknown'}
Pain Point: ${r.analyzed.pain_point || ''}
Theme: ${r.analyzed.theme || ''}
Sentiment: ${r.analyzed.sentiment || ''}
Text: ${r.raw?.review_text || ''}
Summary: ${r.analyzed.summary || ''}`;
  }).join('\n\n');

  const categoryContext = categoryCounts.map(c => `- ${c.name}: ${c.count} classified reviews`).join('\n');

  let hedgeInstruction = "";
  if (retrieved.length < 3) {
    hedgeInstruction = `
[IMPORTANT - LIMITED DATA WARNING]
Only ${retrieved.length} relevant classified user review(s) were available for this query.
Hedge your answer explicitly, keep it brief, and do not imply the evidence is comprehensive.`;
  }

  const prompt = `User Question: ${question}

Selected retrieval intent: ${selection.intent}
Selected pain point categories:
${categoryContext}

Instructions:
1. Answer the User Question using ONLY the information provided in the Reviews below.
2. Do NOT use general knowledge or make assumptions outside the provided reviews.
3. If the provided reviews do not contain enough information to answer the question, state that you do not have enough relevant user reviews to answer.
4. Keep the answer grounded and verifiable.
5. For broad questions, emphasize the categories with larger classified-review counts while still using the real review text below as evidence.
${hedgeInstruction}

Reviews:
${reviewsContext}`;

  const jsonString = await callGroqAPI(prompt, askAnswerSystemPrompt);

  let answer = "";
  let answer_points: string[] = [];
  let used_reviews = true;
  
  try {
    const parsed = parseJsonObject(jsonString);
    if (!parsed) throw new Error('No JSON object found');
    answer = parsed.answer || "";
    answer_points = Array.isArray(parsed.answer_points) ? parsed.answer_points : [];
    used_reviews = parsed.used_reviews ?? true;
  } catch (e: any) {
    console.warn('[askService] Failed to parse LLM response JSON. Error:', e.message);
    console.warn('[askService] Raw LLM Response:', jsonString);
    const cleaned = jsonString.trim();
    const answerMatch = cleaned.match(/"answer"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
    if (answerMatch && answerMatch[1]) {
      answer = answerMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\');
    }
    const pointsMatch = cleaned.match(/"answer_points"\s*:\s*\[([\s\S]*?)\]/);
    if (pointsMatch && pointsMatch[1]) {
      const matches = pointsMatch[1].match(/"((?:[^"\\]|\\.)*)"/g);
      if (matches) {
        answer_points = matches.map(m => m.slice(1, -1)
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"')
          .replace(/\\t/g, '\t')
          .replace(/\\\\/g, '\\'));
      }
    }
    const usedReviewsMatch = cleaned.match(/"used_reviews"\s*:\s*(true|false)/);
    if (usedReviewsMatch) used_reviews = usedReviewsMatch[1] === 'true';
    if (!answer && answer_points.length === 0) answer = cleaned;
  }

  const source_counts = used_reviews ? countSourcesForRetrieved(retrieved) : getEmptySourceCounts();

  const response: AskQuestionResponse & { debug?: AskDebugInfo } = {
    answer,
    answer_points,
    source_counts,
    supporting_reviews: used_reviews ? retrieved.map(r => ({
      ...r.analyzed,
      review_text: r.raw?.review_text || ''
    })) : [],
    debug: {
      ...selection,
      category_counts: categoryCounts,
      sampled_reviews: retrieved.map(r => ({
        id: r.analyzed.id,
        platform: r.raw?.platform || 'Unknown',
        pain_point: r.analyzed.pain_point,
        theme: r.analyzed.theme,
        text_preview: (r.raw?.review_text || '').slice(0, 220),
      })),
      generated_answer: answer,
      generated_answer_points: answer_points,
    }
  };

  await supabaseAdmin.from('question_logs').insert([{
    question,
    answer,
    source_counts,
    supporting_review_ids: response.supporting_reviews.map(r => r.id)
  }]);

  return response;
}
