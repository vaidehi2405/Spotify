/**
 * scrapeAppStore.ts
 * Fetches Spotify reviews from the Apple App Store.
 * Uses app-store-scraper — no API key required.
 */

import * as dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

// app-store-scraper uses a plain CommonJS export (no .default)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const store = require('app-store-scraper');

import { supabaseAdmin } from '../lib/supabaseAdmin';
import { ScrapedReview } from './scrapePlayStore';

const SPOTIFY_APP_ID = 324684580; // Spotify's Apple App Store numeric ID

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

export async function scrapeAppStore(): Promise<ScrapedReview[]> {
  const results: ScrapedReview[] = [];
  const countries = ['us', 'nz', 'my', 'ie'];
  const targetFetchedReviews = 200;
  let fetchedCount = 0;

  console.log('\n🍎 Scraping Apple App Store (Multiple Countries)...');

  for (const country of countries) {
    if (fetchedCount >= targetFetchedReviews) break;
    console.log(`  → Scraping country: ${country.toUpperCase()}`);
    let countryFetched = 0;
    let page = 1;

    while (page <= 5 && countryFetched < 100) {
      let reviews: any[];

      try {
        reviews = await store.reviews({
          id: SPOTIFY_APP_ID,
          country,
          sort: store.sort.RECENT, // latest reviews
          page,
        });
      } catch (err: any) {
        console.error(`    ✗ ${country.toUpperCase()} Page ${page} error: ${err.message}`);
        break;
      }

      if (!reviews || reviews.length === 0) {
        console.log(`    Page ${page}: no reviews returned`);
        if (page === 1) break;
        page++;
        continue;
      }

      countryFetched += reviews.length;
      fetchedCount += reviews.length;

      for (const r of reviews) {
        const title = (r.title || '').trim();
        const body = (r.text || '').trim();
        const rating = r.score;

        const combinedText = `Title: ${title}\nRating: ${rating} Stars\n\n${body}`;

        results.push({
          external_id: `appstore_${r.id}`,
          source: 'App Store',
          platform: 'App Store',
          review_text: combinedText,
          scraped_at: new Date().toISOString(),
          source_url: `https://apps.apple.com/us/app/spotify/id${SPOTIFY_APP_ID}?l=${country}`,
        });
      }

      console.log(`    Page ${page}: ${reviews.length} fetched (country total: ${countryFetched})`);
      page++;
      await sleep(1000);
    }
  }

  // Deduplicate reviews by external_id
  const uniqueResults: ScrapedReview[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (!seen.has(r.external_id)) {
      seen.add(r.external_id);
      uniqueResults.push(r);
    }
  }

  console.log(`  ✅ App Store total kept: ${uniqueResults.length} reviews`);
  return uniqueResults;
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
  console.log(`  💾 Saved ${reviews.length} App Store reviews to Supabase`);
}

// Standalone runner
if (require.main === module) {
  scrapeAppStore().then(saveToSupabase).catch(console.error);
}
