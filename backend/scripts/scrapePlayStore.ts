/**
 * scrapePlayStore.ts
 * Fetches Spotify reviews from Google Play Store (past 90 days).
 * Uses google-play-scraper — no API key required.
 */

import * as dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import gplay from 'google-play-scraper';
import { supabaseAdmin } from '../lib/supabaseAdmin';

const SPOTIFY_APP_ID = 'com.spotify.music';
const DAYS_BACK = 90;
const CUTOFF_MS = Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000;
const MAX_PAGES = 20; // up to ~1000 reviews per run

export interface ScrapedReview {
  external_id: string;
  source: string;        // required NOT NULL in raw_reviews
  platform: string;
  review_text: string;
  scraped_at: string;
  source_url?: string;
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

export async function scrapePlayStore(): Promise<ScrapedReview[]> {
  const results: ScrapedReview[] = [];
  let nextPaginationToken: string | undefined = undefined;

  console.log('\n🤖 Scraping Google Play Store...');

  for (let page = 0; page < MAX_PAGES; page++) {
    let reviews: any[];
    let newToken: string | undefined;

    try {
      const response: any = await (gplay as any).reviews({
        appId: SPOTIFY_APP_ID,
        lang: 'en',
        country: 'us',
        sort: (gplay as any).sort.NEWEST,
        num: 50,
        paginate: true,
        nextPaginationToken,
      });

      // When paginate:true, response = { data: Review[], nextPaginationToken: string | undefined }
      reviews = response.data ?? [];
      newToken = response.nextPaginationToken;
    } catch (err: any) {
      console.error(`  ✗ Page ${page + 1} error: ${err.message}`);
      break;
    }

    if (!reviews || reviews.length === 0) break;

    let hitCutoff = false;

    for (const r of reviews) {
      const date = r.date ? new Date(r.date).getTime() : 0;

      if (date > 0 && date < CUTOFF_MS) {
        hitCutoff = true;
        break;
      }

      const text = (r.text || '').trim();
      if (text.length < 20) continue;

      results.push({
        external_id: `playstore_${r.id}`,
        source: 'Play Store',
        platform: 'Play Store',
        review_text: text,
        scraped_at: new Date().toISOString(),
        source_url: `https://play.google.com/store/apps/details?id=${SPOTIFY_APP_ID}`,
      });
    }

    console.log(`  Page ${page + 1}: ${reviews.length} fetched, ${results.length} kept so far`);

    if (hitCutoff) {
      console.log(`  ✓ Reached ${DAYS_BACK}-day cutoff at page ${page + 1}`);
      break;
    }

    if (!newToken) break; // no more pages
    nextPaginationToken = newToken;
    await sleep(1000);
  }

  console.log(`  ✅ Play Store total: ${results.length} reviews`);
  return results;
}

export async function saveToSupabase(reviews: ScrapedReview[]) {
  if (reviews.length === 0) return;
  const BATCH = 50;
  for (let i = 0; i < reviews.length; i += BATCH) {
    const { error } = await supabaseAdmin
      .from('raw_reviews')
      .upsert(reviews.slice(i, i + BATCH), { onConflict: 'external_id', ignoreDuplicates: true });
    if (error) console.error(`  ✗ Supabase batch error: ${error.message}`);
  }
  console.log(`  💾 Saved ${reviews.length} Play Store reviews to Supabase`);
}

// Standalone runner
if (require.main === module) {
  scrapePlayStore().then(saveToSupabase).catch(console.error);
}
