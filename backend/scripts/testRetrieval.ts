import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables before any service imports
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import { getAllAnalyzedReviews, getAllRawReviews } from '../services/reviewService';
import { retrieveRelevantReviews } from '../services/askService';

async function test() {
  const analyzedReviews = await getAllAnalyzedReviews();
  const rawReviews = await getAllRawReviews();

  const queries = [
    "What's wrong with podcast recommendations?",
    "Why do users keep hearing the same songs?",
    "How do users feel about playlist creation?"
  ];
  console.log('=== Retrieval Quality Verification (Threshold: 0.3) ===\n');

  for (const query of queries) {
    console.log(`QUERY: "${query}"`);
    console.log('='.repeat(80));

    // Retrieve top 10 scored reviews without threshold to show full distribution
    const allResults = retrieveRelevantReviewsUnfiltered(query, analyzedReviews, rawReviews);
    const sorted = [...allResults].sort((a, b) => b.score - a.score).slice(0, 10);

    const aboveThresholdCount = allResults.filter(r => r.score >= 0.3).length;
    console.log(`Total results above threshold (0.3): ${aboveThresholdCount}`);
    if (aboveThresholdCount < 3) {
      console.log('>>> THRESHOLD TRIGGERED: Less than 3 reviews clear 0.3. "Not enough relevant reviews found" message will show on UI.');
    } else {
      console.log('>>> Normal display: Grounded AI answer will be generated using these reviews.');
    }
    console.log();

    console.log('Top 10 retrieved reviews by score:');
    sorted.forEach((res, idx) => {
      const passes = res.score >= 0.3 ? '✅ PASS' : '❌ FAIL';
      console.log(`[#${idx + 1}] Score: ${res.score.toFixed(4)} | ${passes}`);
      console.log(`    Theme      : ${res.analyzed.theme}`);
      console.log(`    Pain Point : ${res.analyzed.pain_point}`);
      console.log(`    Raw Text   : "${(res.raw?.review_text || '').replace(/\n/g, ' ')}"`);
      console.log();
    });

    console.log('='.repeat(80) + '\n');
  }
}

// Inline implementation of unfiltered retrieveRelevantReviews
interface UnfilteredScoredReview {
  analyzed: any;
  raw: any;
  score: number;
}

function retrieveRelevantReviewsUnfiltered(
  query: string,
  analyzedReviews: any[],
  rawReviews: any[]
): UnfilteredScoredReview[] {
  const rawMap = new Map<string, any>();
  for (const r of rawReviews) {
    rawMap.set(r.id, r);
  }

  const docTexts = analyzedReviews.map(r => {
    const raw = rawMap.get(r.raw_review_id);
    return (raw?.review_text || '').trim();
  });

  // Re-use tokenization/stemming from askService
  // We can import stem and tokenize if exported, or just write them inline
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

  return analyzedReviews.map((r, index) => {
    const raw = rawMap.get(r.raw_review_id);
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

    const score = (normQuery === 0 || normReview === 0) 
      ? 0 
      : dotProduct / (Math.sqrt(normQuery) * Math.sqrt(normReview));

    return {
      analyzed: r,
      raw,
      score
    };
  });
}

test().catch(console.error);
