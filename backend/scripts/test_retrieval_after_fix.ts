import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import { getAllAnalyzedReviews, getAllRawReviews } from '../services/reviewService';
import { selectRelevantCategories, buildCategoryInventory, retrieveReviewsByCategories } from '../services/askService';

async function main() {
  const analyzedReviews = await getAllAnalyzedReviews();
  const rawReviews = await getAllRawReviews();
  const inventory = buildCategoryInventory(analyzedReviews);

  const testQuestions = [
    "Why do users feel recommendations are repetitive?",
    "What do users expect from Discover Weekly?",
    "Why do users repeat the same songs?"
  ];

  for (const q of testQuestions) {
    console.log(`\n==================================================`);
    console.log(`QUESTION: "${q}"`);
    const selection = await selectRelevantCategories(q, inventory);
    console.log(`Selection:`, JSON.stringify({ intent: selection.intent, selected_pain_points: selection.selected_pain_points }));

    const retrieved = retrieveReviewsByCategories(selection, analyzedReviews, rawReviews, q);
    console.log(`Retrieved reviews count: ${retrieved.length}`);
    
    // Print first 4 reviews details
    retrieved.slice(0, 4).forEach((r, idx) => {
      console.log(`  [#${idx + 1}] Sentiment: ${r.analyzed.sentiment} | Pain Point: ${r.analyzed.pain_point}`);
      console.log(`      Text: "${(r.raw?.review_text || '').slice(0, 150)}..."`);
    });
  }
}

main().catch(console.error);
