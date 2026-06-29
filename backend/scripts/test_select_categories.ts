import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import { getAllAnalyzedReviews } from '../services/reviewService';
import { selectRelevantCategories, buildCategoryInventory } from '../services/askService';

async function main() {
  const analyzedReviews = await getAllAnalyzedReviews();
  const inventory = buildCategoryInventory(analyzedReviews);

  const testQuestions = [
    "Why do users feel recommendations are repetitive?",
    "What do users expect from Discover Weekly?",
    "Why do users repeat the same songs?",
    "What discovery frustrations are increasing?",
    "how is spotify"
  ];

  for (const q of testQuestions) {
    console.log(`\n==================================================`);
    console.log(`QUESTION: "${q}"`);
    const selection = await selectRelevantCategories(q, inventory);
    console.log(`Selection:`, JSON.stringify(selection, null, 2));
  }
}

main().catch(console.error);
