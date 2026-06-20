import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function run() {
  const { getAllAnalyzedReviews } = await import('../services/reviewService');
  const reviews = await getAllAnalyzedReviews();
  
  const notRelevantFirstPass = reviews.filter(r => r.pain_point === 'not_relevant' && r.user_need === 'not_relevant');
  const notRelevantSecondPass = reviews.filter(r => r.pain_point === 'not_relevant' && r.user_need !== 'not_relevant');

  console.log('Not Relevant (First Pass):', notRelevantFirstPass.length);
  console.log('Not Relevant (Second Pass):', notRelevantSecondPass.length);
}

run().catch(console.error);
