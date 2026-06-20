import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function run() {
  const { logOtherUnspecifiedSamples, reclassifyPoorQualityFallbackReviews } = await import('../services/analysisService');

  await logOtherUnspecifiedSamples(10);

  console.log('\nRunning full second-pass reclassification...\n');
  const refinedCount = await reclassifyPoorQualityFallbackReviews();
  console.log(`Successfully reclassified ${refinedCount} reviews.`);
}

run().catch(console.error);
