import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env.local before importing any services
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function run() {
  const { reanalyzeReviewsFromFile } = await import('../services/analysisService');
  
  console.log('=== File-Based LLM Classification ===');
  console.log('Reading reviews from scraped_raw_reviews.json and running classification...\n');

  const limitArg = process.argv[2];
  const limit = limitArg ? parseInt(limitArg, 10) : undefined;
  if (limit) {
    console.log(`Limiting classification to the first ${limit} pending reviews.\n`);
  }
  
  const count = await reanalyzeReviewsFromFile(limit);
  console.log(`\nSuccessfully classified ${count} new reviews.`);
}

run().catch(console.error);
