import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function run() {
  const { logOtherUnspecifiedSamples } = await import('../services/analysisService');
  await logOtherUnspecifiedSamples(10);
}

run().catch(console.error);
