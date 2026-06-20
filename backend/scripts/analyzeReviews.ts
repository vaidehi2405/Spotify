import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env.local before importing any services
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function run() {
  const { analyzePendingReviews } = await import('../services/analysisService');
  
  console.log('Analyzing pending reviews using Groq API...');
  const analyzedCount = await analyzePendingReviews();
  console.log(`Successfully analyzed ${analyzedCount} reviews.`);
}

run().catch(console.error);
