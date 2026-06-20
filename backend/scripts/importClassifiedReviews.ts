import * as dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function run() {
  const { importClassifiedReviews } = await import('../services/analysisService');
  await importClassifiedReviews();
}

run().catch(console.error);
