import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import { supabaseAdmin } from '../lib/supabaseAdmin';

async function main() {
  const queries = [
    "This app help me to listen",
    "just part of my life",
    "peak bc idk"
  ];

  for (const q of queries) {
    console.log(`Searching for: "${q}"`);
    const { data, error } = await supabaseAdmin
      .from('raw_reviews')
      .select(`
        *,
        analyzed_reviews (*)
      `)
      .ilike('review_text', `%${q}%`);

    if (error) {
      console.error('Error:', error);
      continue;
    }

    console.log(`Found ${data?.length || 0} matches:`);
    data?.forEach((row: any) => {
      console.log(`  Raw Review ID: ${row.id}`);
      console.log(`  Platform: ${row.platform}`);
      console.log(`  Text: "${row.review_text}"`);
      console.log(`  Analyzed:`, JSON.stringify(row.analyzed_reviews, null, 2));
    });
    console.log('='.repeat(50));
  }
}

main().catch(console.error);
