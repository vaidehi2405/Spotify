import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function run() {
  const { reanalyzeMockClassifiedReviews } = await import('../services/analysisService');

  console.log('=== Targeted Re-Analysis: Mock-Classified Reviews ===');
  console.log('This script re-runs first-pass Groq analysis on reviews that were');
  console.log('processed by the local mock fallback, then runs second-pass refinement.\n');

  const count = await reanalyzeMockClassifiedReviews();
  console.log(`\nDone! Total reviews first-pass re-analyzed: ${count}`);
}

run().catch(console.error);
