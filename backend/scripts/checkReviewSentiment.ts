import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import { getAllAnalyzedReviews, getAllRawReviews } from '../services/reviewService';

async function main() {
  const analyzedReviews = await getAllAnalyzedReviews();
  const rawReviews = await getAllRawReviews();

  const targetRaw = rawReviews.find(r => r.review_text.includes('love the podcast on this app'));
  console.log('Target Raw Review:', JSON.stringify(targetRaw, null, 2));

  if (targetRaw) {
    const targetAnalyzed = analyzedReviews.find(r => r.raw_review_id === targetRaw.id);
    console.log('Target Analyzed Review:', JSON.stringify(targetAnalyzed, null, 2));
  }
}

main().catch(console.error);
