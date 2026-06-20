import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { analyzePendingReviews } from '../services/analysisService';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function reanalyze() {
  console.log('Clearing old analyzed reviews...');
  const { error } = await supabase.from('analyzed_reviews').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  
  if (error) {
    console.error('Failed to clear table:', error);
    return;
  }
  
  console.log('Old reviews cleared. Starting fresh analysis...');
  await analyzePendingReviews();
  console.log('Done!');
}

reanalyze();
