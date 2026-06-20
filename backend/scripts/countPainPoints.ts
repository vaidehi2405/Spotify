import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function run() {
  const { getAllAnalyzedReviews } = await import('../services/reviewService');
  const reviews = await getAllAnalyzedReviews();
  const counts: Record<string, number> = {};
  for (const r of reviews) {
    if (r.pain_point) {
      counts[r.pain_point] = (counts[r.pain_point] || 0) + 1;
    }
  }
  console.log('Pain Point Distribution:');
  console.log(JSON.stringify(counts, null, 2));
  console.log('Total analyzed reviews:', reviews.length);
}

run().catch(console.error);
