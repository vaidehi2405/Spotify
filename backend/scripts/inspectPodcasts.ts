import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import { getAllAnalyzedReviews, getAllRawReviews } from '../services/reviewService';
import { RawReview } from '../types/review';

async function main() {
  const rawReviews: RawReview[] = await getAllRawReviews();

  const podcastReviews = rawReviews.filter(r => r.review_text.toLowerCase().includes('podcast'));

  console.log(`--- ALL PODCAST REVIEWS (${podcastReviews.length}) ---`);
  podcastReviews.forEach((r, idx) => {
    console.log(`[${idx+1}] ID: ${r.id} | "${r.review_text}"`);
  });
}

main().catch(console.error);
