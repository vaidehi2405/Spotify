import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function inspect() {
  const { count: rawCount, error: rawCountError } = await supabase.from('raw_reviews').select('*', { count: 'exact', head: true });
  const { data: raw, error: rawError } = await supabase.from('raw_reviews').select('id, platform, source');
  if (rawError || rawCountError) {
    console.error('Error fetching raw:', rawError || rawCountError);
    return;
  }
  
  const { count: analyzedCount, error: analyzedCountError } = await supabase.from('analyzed_reviews').select('*', { count: 'exact', head: true });
  const { data: analyzed, error: analyzedError } = await supabase.from('analyzed_reviews').select('id, pain_point');
  if (analyzedError || analyzedCountError) {
    console.error('Error fetching analyzed:', analyzedError || analyzedCountError);
    return;
  }

  console.log('--- Database Inspection ---');
  console.log(`Total raw reviews count in DB: ${rawCount}`);
  console.log(`Fetched raw reviews (Postgrest limit): ${raw.length}`);
  console.log(`Total analyzed reviews count in DB: ${analyzedCount}`);
  console.log(`Fetched analyzed reviews (Postgrest limit): ${analyzed.length}`);

  const rawPlatforms: Record<string, number> = {};
  const rawSources: Record<string, number> = {};
  raw.forEach(r => {
    const plat = String(r.platform || 'null');
    const src = String(r.source || 'null');
    rawPlatforms[plat] = (rawPlatforms[plat] || 0) + 1;
    rawSources[src] = (rawSources[src] || 0) + 1;
  });

  console.log('\nRaw Platforms:');
  console.log(rawPlatforms);

  console.log('\nRaw Sources:');
  console.log(rawSources);
}

inspect();
