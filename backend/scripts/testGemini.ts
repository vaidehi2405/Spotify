import * as dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function run() {
  const { callGeminiAPI } = await import('../lib/geminiClient');

  console.log('Testing Gemini API connection...\n');

  const result = await callGeminiAPI(
    'Review source: Play Store\n\nReview Text:\nI hate that Spotify keeps recommending the same mainstream songs. I want more indie artists, not just top 40 hits.',
    `You are a PM research analyst performing a second-pass classification on Spotify reviews.
Return ONLY valid JSON: {"pain_point": "Recommendations are too mainstream/generic", "confidence": "high"}`
  );

  console.log('Gemini response:', result);
  console.log('\n✅ Gemini API is working!');
}

run().catch(e => {
  console.error('❌ Gemini test failed:', e.message);
});
