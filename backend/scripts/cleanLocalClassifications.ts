import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { promises as fs } from 'fs';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import { normalizeSentimentFromText } from '../utils/sentiment';
import { importClassifiedReviews } from '../services/analysisService';

function isNonEnglish(text: string): boolean {
  const lower = text.toLowerCase();
  const nonEnglishPatterns = [
    /\bque\b/i, /\bel\b/i, /\bla\b/i, /\blos\b/i, /\blas\b/i,
    /\bcon\b/i, /\bpara\b/i, /\bpor\b/i, /\bdel\b/i, /\bcomo\b/i,
    /\bpero\b/i, /\bsu\b/i, /\btu\b/i, /\beste\b/i, /\besta\b/i,
    /\bse\b/i, /\bsi\b/i, /\bal\b/i, /\buna\b/i, /\bmas\b/i,
    /\bya\b/i, /\bmuy\b/i, /\bcuenta\b/i, /\bdificil\b/i, /\bencontrar\b/i
  ];
  let matches = 0;
  for (const pattern of nonEnglishPatterns) {
    if (pattern.test(lower)) {
      matches++;
    }
  }
  return matches >= 2;
}

function isUnrelatedReview(text: string): boolean {
  const lower = text.toLowerCase();

  // 1. Language check
  if (isNonEnglish(text)) return true;

  // 2. Must contain basic music/recommendation context
  const hasMusicContext = /\b(recommend|suggest|discover|algorithm|shuffle|mix|playlist|radio|song|track|music|artist|genre)\b/i.test(lower);
  if (!hasMusicContext) return true;

  // 3. Widget complaints (e.g. "stop forcing new widgit")
  if (lower.includes('widget') || lower.includes('widgit')) return true;

  // 4. Cost/Price complaints (e.g. "Got too expensive...")
  if (/\b(expensive|cost|price|billing|money|charge|payday)\b/i.test(lower)) return true;

  // 5. Account/Login
  if (/\b(login|password|account|cuenta)\b/i.test(lower)) return true;

  // 6. Downloads/Offline (e.g. "Downloading a playlist...")
  if (/\b(download|offline|local file)\b/i.test(lower)) return true;

  // 7. Lyrics
  if (/\blyrics\b/i.test(lower)) return true;

  // 8. Performance/Crashes (unless it explicitly discusses recommendation quality or algorithms)
  const isPerformance = /\b(crash|freeze|slow|lag|optimization|bug|error|glitch|battery|device|load|open|screen|ui|layout|font|crashed|crashing|buggy)\b/i.test(lower);
  const mentionsRecs = /\b(recommend|suggest|discover|algorithm|shuffle|daily mix|discover weekly|release radar|radio|mix)\b/i.test(lower);
  if (isPerformance && !mentionsRecs) return true;

  // 9. Ads/Commercials (unless recommendations are explicitly mentioned)
  const isAds = /\b(ads|ad\b|advertisement|announcement|pop up|popup|watch the as|watch the ad)\b/i.test(lower);
  if (isAds && !mentionsRecs) return true;

  // 10. Generic complaints with zero recommendation context
  const genericNegative = /\b(garbage|trash|worst|sucks|suck|terrible|awful|bad|useless|deserve one star|deserves one star|disappointed|disappointing|frustrated|frustrating|annoying|hate this app|worst app)\b/i.test(lower);
  if (genericNegative && !mentionsRecs) return true;

  return false;
}

async function main() {
  const classifiedPath = resolve(process.cwd(), 'classified_reviews.json');
  console.log(`Reading local classifications from ${classifiedPath}...`);
  
  const rawData = await fs.readFile(classifiedPath, 'utf8');
  const reviews = JSON.parse(rawData);

  let positiveFixed = 0;
  let unrelatedFixed = 0;

  for (const r of reviews) {
    const text = r.review_text || '';
    
    // Parse rating from review text if embedded (e.g. "Rating: 5 Stars")
    let rating = null;
    const ratingMatch = text.match(/Rating:\s*(\d+)\s*Star/i);
    if (ratingMatch && ratingMatch[1]) {
      rating = parseInt(ratingMatch[1], 10);
    }

    const currentSentiment = r.analysis.sentiment;
    const newSentiment = normalizeSentimentFromText(text, currentSentiment, rating);

    const isExplicitPositive = 
      r.external_id === 'playstore_42827ecb-4af3-41b3-9d71-b38a632e6341' ||
      r.external_id === 'playstore_d9aad297-f684-43f3-870a-f1df3f72787a' ||
      text.includes('loving that I can make my own playlist') ||
      (text.includes('This app is amazing!') && text.includes('ads aren\'t that bad'));

    // Heuristics:
    // 1. If it's a positive review or explicitly marked positive, override to positive
    if (newSentiment === 'positive' || isExplicitPositive) {
      if (r.analysis.sentiment !== 'positive' || r.analysis.pain_point !== 'not_relevant') {
        console.log(`[Positive Override] Text: "${text.slice(0, 70)}..." | Rating: ${rating}`);
        console.log(`  Before: sentiment="${r.analysis.sentiment}", pain_point="${r.analysis.pain_point}"`);
        r.analysis.sentiment = 'positive';
        r.analysis.pain_point = 'not_relevant';
        r.analysis.theme = 'Unrelated';
        positiveFixed++;
      }
    }
    // 2. If it is clearly not about recommendations, set to not_relevant
    else if (isUnrelatedReview(text)) {
      if (r.analysis.pain_point !== 'not_relevant') {
        console.log(`[Unrelated Override] Text: "${text.slice(0, 70)}..."`);
        console.log(`  Before: pain_point="${r.analysis.pain_point}", theme="${r.analysis.theme}"`);
        r.analysis.pain_point = 'not_relevant';
        r.analysis.theme = 'Unrelated';
        unrelatedFixed++;
      }
    }
  }

  console.log(`\nLocal heuristic cleanup complete:`);
  console.log(`- Positive overrides:  ${positiveFixed}`);
  console.log(`- Unrelated overrides: ${unrelatedFixed}`);

  if (positiveFixed > 0 || unrelatedFixed > 0) {
    await fs.writeFile(classifiedPath, JSON.stringify(reviews, null, 2), 'utf8');
    console.log(`Saved updated classifications to ${classifiedPath}.`);
    
    console.log(`\nImporting cleaned reviews into Database...`);
    await importClassifiedReviews();
    console.log(`Database sync complete!`);
  } else {
    console.log('No reviews needed heuristic cleanups.');
  }
}

main().catch(console.error);
