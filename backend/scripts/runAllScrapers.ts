/**
 * runAllScrapers.ts
 * -----------------
 * Orchestrates store scrapers and saves results to Supabase.
 *
 * Active sources:
 *   1. Google Play Store     (google-play-scraper, no key)
 *   2. Apple App Store       (app-store-scraper, no key)
 *   3. Spotify Community     (axios + cheerio, no key)
 *
 * Disabled (enable when ready):
 *   - YouTube            → import { scrapeYouTube } from './scrapeYouTube'
 *
 * Usage: npx ts-node scripts/runAllScrapers.ts
 */

import * as dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import { promises as fs } from 'fs';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { scrapePlayStore, ScrapedReview } from './scrapePlayStore';
import { scrapeAppStore } from './scrapeAppStore';
import { scrapeSpotifyCommunity } from './scrapeSpotifyCommunity';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function saveToLocalJSON(reviews: ScrapedReview[]): Promise<void> {
  if (reviews.length === 0) return;
  const filePath = resolve(process.cwd(), 'scraped_raw_reviews.json');

  await fs.writeFile(filePath, JSON.stringify(reviews, null, 2), 'utf8');
  console.log(`  [Local JSON] 💾 Overwrote and saved ${reviews.length} reviews to ${filePath}`);
}

async function upsertToSupabase(reviews: ScrapedReview[], label: string): Promise<number> {
  if (reviews.length === 0) {
    console.log(`  [${label}] Nothing to save.`);
    return 0;
  }

  const BATCH = 50;
  let saved = 0;

  for (let i = 0; i < reviews.length; i += BATCH) {
    const { error, data } = await supabaseAdmin
      .from('raw_reviews')
      .upsert(reviews.slice(i, i + BATCH), { onConflict: 'external_id', ignoreDuplicates: true })
      .select('id');

    if (error) {
      console.error(`  [${label}] ✗ Batch error: ${error.message}`);
    } else {
      saved += (data ?? []).length;
    }
  }

  console.log(`  [${label}] 💾 ${saved} new rows inserted (${reviews.length - saved} duplicates skipped)`);
  return saved;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runAllScrapers(): Promise<void> {
  const startTime = Date.now();
  const summary: Record<string, { scraped: number; saved: number }> = {};
  const allScraped: ScrapedReview[] = [];

  console.log('\n══════════════════════════════════════════');
  console.log('  🚀 SCRAPING PIPELINE STARTED');
  console.log(`  ${new Date().toISOString()}`);
  console.log('══════════════════════════════════════════');

  // ── 1. Google Play Store ───────────────────────────────────────────────────
  try {
    const reviews = await scrapePlayStore();
    allScraped.push(...reviews);
    const saved = await upsertToSupabase(reviews, 'Play Store');
    summary['Play Store'] = { scraped: reviews.length, saved };
  } catch (err: any) {
    console.error(`\n❌ Play Store failed: ${err.message}`);
    summary['Play Store'] = { scraped: 0, saved: 0 };
  }

  await sleep(2000);

  // ── 2. Apple App Store ─────────────────────────────────────────────────────
  try {
    const reviews = await scrapeAppStore();
    allScraped.push(...reviews);
    const saved = await upsertToSupabase(reviews, 'App Store');
    summary['App Store'] = { scraped: reviews.length, saved };
  } catch (err: any) {
    console.error(`\n❌ App Store failed: ${err.message}`);
    summary['App Store'] = { scraped: 0, saved: 0 };
  }

  await sleep(2000);

  // ── 3. Spotify Community ───────────────────────────────────────────────────
  try {
    const reviews = await scrapeSpotifyCommunity();
    allScraped.push(...reviews);
    const saved = await upsertToSupabase(reviews, 'Spotify Community');
    summary['Spotify Community'] = { scraped: reviews.length, saved };
  } catch (err: any) {
    console.error(`\n❌ Spotify Community failed: ${err.message}`);
    summary['Spotify Community'] = { scraped: 0, saved: 0 };
  }

  // ── Save to local JSON ──────────────────────────────────────────────────────
  try {
    await saveToLocalJSON(allScraped);
  } catch (err: any) {
    console.error(`\n❌ Saving to local JSON failed: ${err.message}`);
  }

  // ── Final Report ───────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalScraped = Object.values(summary).reduce((a, b) => a + b.scraped, 0);
  const totalSaved   = Object.values(summary).reduce((a, b) => a + b.saved,   0);

  console.log('\n══════════════════════════════════════════');
  console.log('  ✅ SCRAPING PIPELINE COMPLETE');
  console.log(`  Duration: ${elapsed}s`);
  console.log('──────────────────────────────────────────');
  for (const [source, stats] of Object.entries(summary)) {
    console.log(`  ${source.padEnd(20)} scraped: ${String(stats.scraped).padStart(4)}  new: ${String(stats.saved).padStart(4)}`);
  }
  console.log('──────────────────────────────────────────');
  console.log(`  TOTAL                scraped: ${String(totalScraped).padStart(4)}  new: ${String(totalSaved).padStart(4)}`);
  console.log('══════════════════════════════════════════\n');
}

// Standalone runner
if (require.main === module) {
  runAllScrapers().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
  });
}
