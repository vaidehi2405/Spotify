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

async function saveToLocalJSON(newReviews: ScrapedReview[]): Promise<void> {
  if (newReviews.length === 0) return;
  const filePath = resolve(process.cwd(), 'scraped_raw_reviews.json');
  let existingReviews: ScrapedReview[] = [];

  try {
    const rawData = await fs.readFile(filePath, 'utf8');
    existingReviews = JSON.parse(rawData);
  } catch (err) {
    // Start with empty array if file does not exist
  }

  // Merge and deduplicate
  const mergedMap = new Map<string, ScrapedReview>();
  for (const r of existingReviews) {
    mergedMap.set(r.external_id, r);
  }
  for (const r of newReviews) {
    mergedMap.set(r.external_id, r);
  }

  const mergedList = Array.from(mergedMap.values());
  await fs.writeFile(filePath, JSON.stringify(mergedList, null, 2), 'utf8');
  console.log(`  [Local JSON] 💾 Saved ${newReviews.length} new reviews (total: ${mergedList.length}) to ${filePath}`);
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

export async function getLatestScrapedAt(source: string): Promise<Date | null> {
  const { data, error } = await supabaseAdmin
    .from('raw_reviews')
    .select('scraped_at')
    .eq('source', source)
    .order('scraped_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error(`  [${source}] Error fetching latest scraped_at:`, error.message);
    return null;
  }

  if (data && data.length > 0 && data[0].scraped_at) {
    return new Date(data[0].scraped_at);
  }
  return null;
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
    const since = await getLatestScrapedAt('Play Store');
    console.log(`  [Play Store] Scraping reviews newer than: ${since ? since.toISOString() : '90 days cutoff'}`);
    const reviews = await scrapePlayStore(since || undefined);
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
    const since = await getLatestScrapedAt('App Store');
    console.log(`  [App Store] Scraping reviews newer than: ${since ? since.toISOString() : '90 days cutoff'}`);
    const reviews = await scrapeAppStore(since || undefined);
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
    const since = await getLatestScrapedAt('Spotify Community');
    console.log(`  [Spotify Community] Scraping threads newer than: ${since ? since.toISOString() : 'Beginning'}`);
    const reviews = await scrapeSpotifyCommunity(since || undefined);
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
