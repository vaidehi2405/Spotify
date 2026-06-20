import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import { getAllAnalyzedReviews, getAllRawReviews } from '../services/reviewService';
import { RawReview, AnalyzedReview } from '../types/review';

async function main() {
  const analyzedReviews: AnalyzedReview[] = await getAllAnalyzedReviews();
  const rawReviews: RawReview[] = await getAllRawReviews();

  console.log(`Total Raw Reviews: ${rawReviews.length}`);
  console.log(`Total Analyzed Reviews: ${analyzedReviews.length}`);

  // Group by theme
  const themes = new Map<string, number>();
  for (const r of analyzedReviews) {
    themes.set(r.theme, (themes.get(r.theme) || 0) + 1);
  }
  console.log('\n--- Theme Counts ---');
  for (const [theme, count] of themes.entries()) {
    console.log(`  ${theme}: ${count}`);
  }

  // Find reviews containing specific keywords
  const keywords = ['podcast', 'shuffle', 'repeat', 'song', 'playlist'];
  console.log('\n--- Keyword Matches in Raw Text ---');
  for (const kw of keywords) {
    const matches = rawReviews.filter((r: RawReview) => r.review_text.toLowerCase().includes(kw));
    console.log(`  "${kw}": ${matches.length} matches`);
    if (matches.length > 0) {
      console.log(`    Examples:`);
      matches.slice(0, 10).forEach((m: RawReview, idx: number) => {
        console.log(`      [${idx + 1}] ID: ${m.id} | Platform: ${m.platform} | Text: "${m.review_text}"`);
      });
    }
  }
}

main().catch(console.error);
