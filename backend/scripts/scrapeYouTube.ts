/**
 * scrapeYouTube.ts
 * Fetches comments from YouTube videos about Spotify music discovery.
 * Requires YOUTUBE_API_KEY in .env.local
 */

import * as dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import axios from 'axios';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { ScrapedReview } from './scrapePlayStore';

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY!;
const YT_BASE = 'https://www.googleapis.com/youtube/v3';

const SEARCH_QUERIES = [
  'spotify music discovery review',
  'spotify recommendations algorithm',
  'spotify discover weekly honest review',
  'spotify playlist suggestions problem',
];

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function cleanText(raw: string): string {
  return raw.replace(/\s+/g, ' ').replace(/[\r\n]+/g, ' ').trim();
}

async function searchVideos(query: string): Promise<string[]> {
  const { data } = await axios.get(`${YT_BASE}/search`, {
    params: {
      part: 'id',
      q: query,
      type: 'video',
      maxResults: 5,
      relevanceLanguage: 'en',
      key: YOUTUBE_API_KEY,
    },
  });
  return (data.items ?? []).map((item: any) => item.id.videoId as string);
}

async function fetchVideoComments(videoId: string): Promise<ScrapedReview[]> {
  const results: ScrapedReview[] = [];

  const { data } = await axios.get(`${YT_BASE}/commentThreads`, {
    params: {
      part: 'snippet',
      videoId,
      maxResults: 100,
      order: 'relevance',
      key: YOUTUBE_API_KEY,
    },
  });

  for (const item of data.items ?? []) {
    const snippet = item.snippet.topLevelComment.snippet;
    const likeCount: number = snippet.likeCount ?? 0;
    const text = cleanText(snippet.textOriginal ?? '');
    const commentId: string = item.snippet.topLevelComment.id;

    if (likeCount > 5 && text.length > 20) {
      results.push({
        external_id: `youtube_comment_${commentId}`,
        platform: 'YouTube',
        review_text: text,
        scraped_at: new Date().toISOString(),
        source_url: `https://www.youtube.com/watch?v=${videoId}&lc=${commentId}`,
      });
    }
  }

  return results;
}

export async function scrapeYouTube(): Promise<ScrapedReview[]> {
  if (!YOUTUBE_API_KEY || YOUTUBE_API_KEY === 'YOUR_YOUTUBE_API_KEY_HERE') {
    console.warn('  ⚠ YOUTUBE_API_KEY not set — skipping YouTube scrape');
    return [];
  }

  const allReviews: ScrapedReview[] = [];
  const seenVideoIds = new Set<string>();

  console.log('\n📺 Scraping YouTube...');

  for (const query of SEARCH_QUERIES) {
    console.log(`  → Searching: "${query}"`);

    let videoIds: string[] = [];
    try {
      videoIds = await searchVideos(query);
    } catch (err: any) {
      console.error(`    ✗ Search failed: ${err.message}`);
      continue;
    }

    for (const videoId of videoIds) {
      if (seenVideoIds.has(videoId)) continue;
      seenVideoIds.add(videoId);

      try {
        const comments = await fetchVideoComments(videoId);
        allReviews.push(...comments);
        console.log(`    Video ${videoId}: ${comments.length} qualifying comments`);
        await sleep(300);
      } catch (err: any) {
        console.warn(`    ⚠ Comments unavailable for ${videoId}: ${err.message}`);
      }
    }

    await sleep(500);
  }

  console.log(`  ✅ YouTube total: ${allReviews.length} comments`);
  return allReviews;
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
  console.log(`  💾 Saved ${reviews.length} YouTube reviews to Supabase`);
}

if (require.main === module) {
  scrapeYouTube().then(saveToSupabase).catch(console.error);
}
