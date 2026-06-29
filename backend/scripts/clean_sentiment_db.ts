import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import { getAllAnalyzedReviews, getAllRawReviews } from '../services/reviewService';
import { normalizeSentimentFromText } from '../utils/sentiment';
import { supabaseAdmin } from '../lib/supabaseAdmin';

async function main() {
  console.log('Loading reviews from Database...');
  const analyzedReviews = await getAllAnalyzedReviews();
  const rawReviews = await getAllRawReviews();

  console.log(`Loaded ${analyzedReviews.length} analyzed and ${rawReviews.length} raw reviews.`);

  const rawMap = new Map();
  for (const raw of rawReviews) {
    rawMap.set(raw.id, raw);
  }

  let updatedCount = 0;

  for (const ar of analyzedReviews) {
    const raw = rawMap.get(ar.raw_review_id);
    if (!raw) continue;

    const newSentiment = normalizeSentimentFromText(raw.review_text, ar.sentiment, raw.rating);

    if (newSentiment !== ar.sentiment) {
      console.log(`Updating ID ${ar.id} sentiment: "${ar.sentiment}" -> "${newSentiment}"`);
      console.log(`  Text: "${raw.review_text}"`);
      
      const { error } = await supabaseAdmin
        .from('analyzed_reviews')
        .update({ sentiment: newSentiment })
        .eq('id', ar.id);

      if (error) {
        console.error(`  ✗ Error updating: ${error.message}`);
      } else {
        updatedCount++;
      }
    }
  }

  console.log(`\n🎉 Completed! Sentiment updated for ${updatedCount} reviews.`);
}

main().catch(console.error);
