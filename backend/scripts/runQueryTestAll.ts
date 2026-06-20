import * as dotenv from 'dotenv';
import { resolve } from 'path';
import * as fs from 'fs';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import { getAllAnalyzedReviews, getAllRawReviews } from '../services/reviewService';

// Re-use tokenization/stemming and matching logic from askService/testRetrieval.ts
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

function tokenize(text: string, stopwords: Set<string>): string[] {
  if (!text) return [];
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

function runTest(stopwords: Set<string>, label: string) {
  return async () => {
    const analyzedReviews = await getAllAnalyzedReviews();
    const rawReviews = await getAllRawReviews();

    const rawMap = new Map<string, any>();
    for (const r of rawReviews) {
      rawMap.set(r.id, r);
    }

    // Exclude reviews where pain_point is "not_relevant"
    const candidates = analyzedReviews.filter(r => r.pain_point !== 'not_relevant');

    const docTexts = candidates.map(r => {
      const raw = rawMap.get(r.raw_review_id);
      return (raw?.review_text || '').trim();
    });

    const docTokens = docTexts.map(text => tokenize(text, stopwords));
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

    const queries = [
      "What's wrong with podcast recommendations?",
      "Why do users keep hearing the same songs?",
      "How do users feel about playlist creation?"
    ];

    let output = `=== ${label} ===\n\n`;

    for (const query of queries) {
      output += `QUERY: "${query}"\n`;
      output += '='.repeat(80) + '\n';

      const queryTokens = tokenize(query, stopwords);
      const queryVector = embed(queryTokens);
      output += `Query tokens: [${queryTokens.join(', ')}]\n\n`;

      const TOPIC_TERMS = new Set([
        'podcast', 'playlist', 'shuffle', 'dj', 'ad', 'premium', 'song', 'artist', 'mix', 'widget', 'radar', 'recommend', 'discover', 'suggest', 'music'
      ]);
      const queryTopics = queryTokens.filter(t => TOPIC_TERMS.has(t));

      const scored = candidates.map((r, index) => {
        const raw = rawMap.get(r.raw_review_id);
        const reviewTokens = docTokens[index];

        // If the query contains topic terms, the review must match at least one of them
        let topicMatch = true;
        if (queryTopics.length > 0) {
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
        }

        return { analyzed: r, raw, score };
      });

      const sorted = scored.sort((a, b) => b.score - a.score).slice(0, 10);
      const aboveThresholdCount = scored.filter(r => r.score >= 0.3).length;

      output += `Total results above threshold (0.3): ${aboveThresholdCount}\n`;
      if (aboveThresholdCount < 3) {
        output += '>>> THRESHOLD TRIGGERED: Less than 3 reviews clear 0.3. "Not enough relevant reviews found" message will show on UI.\n';
      } else {
        output += '>>> Normal display: Grounded AI answer will be generated using these reviews.\n';
      }
      output += '\n';

      sorted.forEach((res, idx) => {
        const passes = res.score >= 0.3 ? '✅ PASS' : '❌ FAIL';
        output += `[#${idx + 1}] Score: ${res.score.toFixed(4)} | ${passes}\n`;
        output += `    Theme      : ${res.analyzed.theme}\n`;
        output += `    Pain Point : ${res.analyzed.pain_point}\n`;
        output += `    Raw Text   : "${(res.raw?.review_text || '').replace(/\n/g, ' ')}"\n\n`;
      });

      output += '='.repeat(80) + '\n\n';
    }

    return output;
  };
}

async function main() {
  const originalStopwords = new Set([
    'the', 'and', 'to', 'of', 'in', 'i', 'is', 'that', 'it', 'on', 'you', 'this',
    'for', 'but', 'with', 'a', 'an', 'or', 'about', 'why', 'do', 'are', 'what',
    'who', 'how', 'where', 'when', 'which', 'be', 'been', 'was', 'were', 'has',
    'have', 'had', 'does', 'did', 'feel', 'users', 'about', 'from', 'by', 'at'
  ]);

  const expandedStopwords = new Set([
    ...originalStopwords,
    'keep', 'keeps', 'hear', 'hearing', 'listen', 'listening', 'get', 'gets', 'app', 'spotify', 'music'
  ]);

  const runner1 = runTest(originalStopwords, "ORIGINAL STOPWORDS");
  const runner2 = runTest(expandedStopwords, "EXPANDED STOPWORDS (hear/listening/keep/etc)");

  const out1 = await runner1();
  const out2 = await runner2();

  const finalOutput = out1 + '\n\n' + '#'.repeat(100) + '\n\n' + out2;
  const outputPath = resolve(__dirname, 'query_test_results_all.txt');
  fs.writeFileSync(outputPath, finalOutput);
  console.log(`All results written to ${outputPath}`);
}

main().catch(console.error);
