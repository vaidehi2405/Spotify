import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import { getAllRawReviews } from '../services/reviewService';
import { RawReview } from '../types/review';

async function main() {
  const rawReviews: RawReview[] = await getAllRawReviews();

  const createReviews = rawReviews.filter((r: RawReview) => 
    r.review_text.toLowerCase().includes('creat')
  );

  console.log(`Reviews containing 'creat': ${createReviews.length}`);
  createReviews.forEach((r, idx) => {
    console.log(`[${idx + 1}] "${r.review_text}"`);
  });
}

main().catch(console.error);
