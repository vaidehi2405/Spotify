import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import { getAllAnalyzedReviews, getAllRawReviews } from '../services/reviewService';
import { retrieveRelevantReviews, expandQuery } from '../services/askService';

async function main() {
  const analyzedReviews = await getAllAnalyzedReviews();
  const rawReviews = await getAllRawReviews();

  const queries = [
    "what is ipl?",
    "how is spotify in terms of discovering new music?",
    "why is smart shuffle broken?"
  ];

  console.log("=== Query Expansion Verification Test ===\n");

  for (const query of queries) {
    console.log(`Original Query: "${query}"`);
    const expanded = await expandQuery(query);
    console.log(`Expanded Keywords: "${expanded}"`);
    
    const combined = expanded ? `${query}, ${expanded}` : query;
    const results = retrieveRelevantReviews(combined, analyzedReviews, rawReviews, 10);
    
    console.log(`Results retrieved above threshold (0.28): ${results.length}`);
    if (results.length > 0) {
      results.forEach((r, idx) => {
        console.log(`  [#${idx + 1}] Score: ${r.score.toFixed(4)} | Theme: ${r.analyzed.theme}`);
        console.log(`      Text: "${(r.raw?.review_text || '').slice(0, 100)}..."`);
      });
    } else {
      console.log("  (No reviews cleared the threshold)");
    }
    console.log("\n" + "=".repeat(80) + "\n");
  }
}

main().catch(console.error);
