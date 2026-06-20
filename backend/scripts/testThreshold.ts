import * as dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import { getAllAnalyzedReviews, getAllRawReviews } from '../services/reviewService';
import { retrieveRelevantReviews } from '../services/askService';

async function main() {
  const analyzed = await getAllAnalyzedReviews();
  const raw = await getAllRawReviews();
  
  console.log(`Total analyzed reviews: ${analyzed.length}`);
  console.log(`Total raw reviews: ${raw.length}`);

  const queries = [
    "What's wrong with podcast recommendations?",
    "Why do users keep hearing the same songs?"
  ];

  for (const query of queries) {
    console.log('\n' + '='.repeat(80));
    console.log(`QUERY: "${query}"`);
    console.log('='.repeat(80));
    
    const results = retrieveRelevantReviews(query, analyzed, raw, 10);
    
    console.log(`\nResults returned: ${results.length}`);
    
    if (results.length < 3) {
      console.log('>>> THRESHOLD TRIGGERED: Would show "Not enough relevant reviews found"');
    } else {
      console.log('>>> Sufficient reviews found, normal answer display');
    }
    
    console.log('\nTop results with scores:');
    results.forEach((r, i) => {
      console.log(`  #${i+1} [score: ${r.score.toFixed(4)}] theme="${r.analyzed.theme}" pain_point="${r.analyzed.pain_point}" text="${(r.raw?.review_text || '').slice(0, 80)}..."`);
    });

    // Also show how many were BELOW threshold to verify filtering
    const allScored = retrieveRelevantReviewsUnfiltered(query, analyzed, raw);
    const belowThreshold = allScored.filter(s => s.score < 0.15 && s.score > 0);
    const aboveThreshold = allScored.filter(s => s.score >= 0.15);
    console.log(`\n  Reviews with score >= 0.15: ${aboveThreshold.length}`);
    console.log(`  Reviews with score > 0 but < 0.15: ${belowThreshold.length}`);
    console.log(`  Reviews with score = 0: ${allScored.filter(s => s.score === 0).length}`);
  }

  // done
}

// Duplicate the scoring logic without the filter/limit to see full distribution
function retrieveRelevantReviewsUnfiltered(query: string, analyzedReviews: any[], rawReviews: any[]) {
  // Minimal inline reimplementation to get all scores
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
    return w;
  }

  function tokenize(text: string): string[] {
    const stopwords = new Set([
      'the', 'and', 'to', 'of', 'in', 'i', 'is', 'that', 'it', 'on', 'you', 'this',
      'for', 'but', 'with', 'a', 'an', 'or', 'about', 'why', 'do', 'are', 'what',
      'who', 'how', 'where', 'when', 'which', 'be', 'been', 'was', 'were', 'has',
      'have', 'had', 'does', 'did', 'feel', 'users', 'about', 'from', 'by', 'at'
    ]);
    return (text || '')
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

  const docTexts = analyzedReviews.map((r: any) =>
    `${r.pain_point || ''} ${r.summary || ''} ${r.theme || ''}`.trim()
  );
  const docTokens = docTexts.map((text: string) => tokenize(text));
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

  return analyzedReviews.map((r: any, index: number) => {
    const reviewVector = embed(docTokens[index]);
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

    const score = (normQuery === 0 || normReview === 0) ? 0 : dotProduct / (Math.sqrt(normQuery) * Math.sqrt(normReview));
    return { analyzed: r, score };
  });
}

main().catch(console.error);
