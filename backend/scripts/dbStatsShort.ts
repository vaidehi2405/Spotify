import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import { getAllAnalyzedReviews, getAllRawReviews } from '../services/reviewService';
import { RawReview } from '../types/review';

async function main() {
  const rawReviews: RawReview[] = await getAllRawReviews();

  const keywords = ['podcast', 'shuffle', 'repeat'];
  
  for (const kw of keywords) {
    const matches = rawReviews.filter((r: RawReview) => r.review_text.toLowerCase().includes(kw));
    console.log(`\n==================================================`);
    console.log(`Keyword: "${kw}" (${matches.length} matches)`);
    console.log(`==================================================`);
    matches.forEach((m, idx) => {
      console.log(`[${idx + 1}] ID: ${m.id} | Platform: ${m.platform}`);
      console.log(`    Text: "${m.review_text}"`);
    });
  }
}

main().catch(console.error);
