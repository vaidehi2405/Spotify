import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import { supabaseAdmin } from '../lib/supabaseAdmin';

async function main() {
  const { data, error } = await supabaseAdmin
    .from('question_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(15);

  if (error) {
    console.error('Error fetching question logs:', error);
    return;
  }

  console.log(`Retrieved ${data?.length || 0} question logs:\n`);
  data?.forEach((row: any, index: number) => {
    console.log(`[${index + 1}] Created At: ${row.created_at}`);
    console.log(`    Question: "${row.question}"`);
    console.log(`    Answer  : "${row.answer.slice(0, 150)}..."`);
    console.log(`    Sources : ${JSON.stringify(row.source_counts)}`);
    console.log('-'.repeat(60));
  });
}

main().catch(console.error);
