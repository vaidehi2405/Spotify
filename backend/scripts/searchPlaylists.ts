import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import { getAllRawReviews } from '../services/reviewService';
import { RawReview } from '../types/review';

async function main() {
  const rawReviews: RawReview[] = await getAllRawReviews();

  const playlistReviews = rawReviews.filter((r: RawReview) => 
    r.review_text.toLowerCase().includes('playlist')
  );

  console.log(`Reviews containing 'playlist': ${playlistReviews.length}`);
  playlistReviews.forEach((r, idx) => {
    // Check if it has any create-related keywords
    const hasCreate = r.review_text.toLowerCase().match(/(creat|make|making|built|build|curat)/);
    if (hasCreate) {
      console.log(`[${idx + 1}] Matches create/make/curat: "${r.review_text.slice(0, 300)}..."`);
    }
  });
}

main().catch(console.error);
