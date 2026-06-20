/**
 * scrapeFeedback.ts
 * -----------------
 * Fetches user feedback from two sources:
 *   1. YouTube comments via the YouTube Data API v3
 *   2. Spotify Community Forum via axios + cheerio
 *
 * Merges both into a single combined_feedback.json sorted by engagement.
 *
 * Usage:
 *   npx ts-node scripts/scrapeFeedback.ts
 *
 * Requires in .env.local:
 *   YOUTUBE_API_KEY=your_key_here
 */

import * as dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import axios from 'axios';
import * as cheerio from 'cheerio';
import * as fs from 'fs';

// ─── Config ──────────────────────────────────────────────────────────────────

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY!;
const OUTPUT_FILE = resolve(process.cwd(), 'combined_feedback.json');

const YOUTUBE_SEARCH_QUERIES = [
  'spotify music discovery review',
  'spotify recommendations algorithm',
  'spotify discover weekly honest review',
  'spotify playlist suggestions',
];

const SPOTIFY_COMMUNITY_QUERIES = [
  'music discovery',
  'recommendations',
  'discover weekly',
  'algorithm',
];

const YT_BASE = 'https://www.googleapis.com/youtube/v3';
const COMMUNITY_BASE = 'https://community.spotify.com';

// ─── Types ───────────────────────────────────────────────────────────────────

interface FeedbackItem {
  source: 'YouTube' | 'SpotifyCommunity';
  text: string;
  engagement: number;   // like count (YT) | reply count (Spotify)
  url?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function cleanText(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

// ─── SOURCE 1: YouTube ───────────────────────────────────────────────────────

/**
 * Search YouTube for videos matching a query.
 * Returns up to 5 video IDs per query.
 */
async function searchYouTubeVideos(query: string): Promise<string[]> {
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

/**
 * Fetch up to 100 top-level comments for a video.
 * Filters to comments with likeCount > 5.
 */
async function fetchYouTubeComments(videoId: string): Promise<FeedbackItem[]> {
  const results: FeedbackItem[] = [];
  let pageToken: string | undefined;

  do {
    const { data } = await axios.get(`${YT_BASE}/commentThreads`, {
      params: {
        part: 'snippet',
        videoId,
        maxResults: 100,
        order: 'relevance',
        pageToken,
        key: YOUTUBE_API_KEY,
      },
    });

    for (const item of data.items ?? []) {
      const snippet = item.snippet.topLevelComment.snippet;
      const likeCount: number = snippet.likeCount ?? 0;
      const text: string = cleanText(snippet.textOriginal ?? '');

      if (likeCount > 5 && text.length > 20) {
        results.push({
          source: 'YouTube',
          text,
          engagement: likeCount,
          url: `https://www.youtube.com/watch?v=${videoId}`,
        });
      }
    }

    // YouTube returns up to 100 comments per page — one page is enough for us
    pageToken = undefined;
  } while (pageToken);

  return results;
}

/**
 * Master YouTube scraper: searches all queries, fetches comments for each video.
 */
async function scrapeYouTube(): Promise<FeedbackItem[]> {
  if (!YOUTUBE_API_KEY || YOUTUBE_API_KEY === 'YOUR_YOUTUBE_API_KEY_HERE') {
    throw new Error('YOUTUBE_API_KEY is not set in .env.local');
  }

  const allItems: FeedbackItem[] = [];
  const seenVideoIds = new Set<string>();

  console.log('\n📺 Scraping YouTube...');

  for (const query of YOUTUBE_SEARCH_QUERIES) {
    console.log(`  → Searching: "${query}"`);

    let videoIds: string[];
    try {
      videoIds = await searchYouTubeVideos(query);
    } catch (err: any) {
      console.error(`    ✗ Search failed: ${err.message}`);
      continue;
    }

    console.log(`    Found ${videoIds.length} videos`);

    for (const videoId of videoIds) {
      if (seenVideoIds.has(videoId)) continue;
      seenVideoIds.add(videoId);

      try {
        const comments = await fetchYouTubeComments(videoId);
        console.log(`    Video ${videoId}: ${comments.length} qualifying comments`);
        allItems.push(...comments);
        await sleep(300); // stay well within quota
      } catch (err: any) {
        // Comments disabled or quota error
        console.warn(`    ⚠ Could not fetch comments for ${videoId}: ${err.message}`);
      }
    }

    await sleep(500);
  }

  console.log(`  ✅ YouTube total: ${allItems.length} comments`);
  return allItems;
}

// ─── SOURCE 2: Spotify Community Forum ───────────────────────────────────────

/** Build Spotify Community search URL for a keyword */
function communitySearchUrl(query: string): string {
  // Lithium/Khoros platform search endpoint
  return `${COMMUNITY_BASE}/t5/forums/searchpage/tab/message?q=${encodeURIComponent(query)}&filter=location&location=category:English&search_type=thread`;
}

/**
 * Scrape a single Spotify Community search results page.
 * Returns post titles + body previews with reply counts.
 */
async function scrapeCommunitySearchPage(query: string): Promise<FeedbackItem[]> {
  const url = communitySearchUrl(query);

  const { data: html } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: 15000,
  });

  const $ = cheerio.load(html);
  const items: FeedbackItem[] = [];

  // Khoros/Lithium post cards — try multiple selectors for resilience
  const postSelectors = [
    '.lia-message-subject',           // post title links
    '.lia-quilt-row-subject a',
    '.message-subject a',
    'h2.lia-message-subject a',
  ];

  // Find all post title elements
  let titleElements = $();
  for (const sel of postSelectors) {
    titleElements = $(sel);
    if (titleElements.length > 0) break;
  }

  titleElements.each((_, el) => {
    const titleEl = $(el);
    const title = cleanText(titleEl.text());
    const href = titleEl.attr('href') ?? '';
    const postUrl = href.startsWith('http') ? href : `${COMMUNITY_BASE}${href}`;

    // Find reply count near this element
    const container = titleEl.closest('.lia-component-search-result, .lia-message-item, li');
    const replyText = container
      .find('.lia-quilt-column-replies, .reply-count, .lia-message-stats-count, [class*="reply"]')
      .first()
      .text()
      .replace(/[^0-9]/g, '');
    const replyCount = parseInt(replyText || '0', 10);

    if (title.length > 10 && replyCount > 5) {
      items.push({
        source: 'SpotifyCommunity',
        text: title,
        engagement: replyCount,
        url: postUrl,
      });
    }
  });

  // Fallback: if Khoros structure changed, scrape any links that look like posts
  if (items.length === 0) {
    console.warn(`    ⚠ Primary selectors found no posts for "${query}" — trying fallback`);

    $('a[href*="/t5/"]').each((_, el) => {
      const linkEl = $(el);
      const href = linkEl.attr('href') ?? '';
      const text = cleanText(linkEl.text());

      // Skip nav links, breadcrumbs, etc.
      if (
        text.length < 15 ||
        href.includes('/user/') ||
        href.includes('/profile/') ||
        href.includes('page=') ||
        href.endsWith('/t5/')
      ) return;

      items.push({
        source: 'SpotifyCommunity',
        text,
        engagement: 0,
        url: href.startsWith('http') ? href : `${COMMUNITY_BASE}${href}`,
      });
    });
  }

  return items;
}

/**
 * Master Spotify Community scraper.
 */
async function scrapeSpotifyCommunity(): Promise<FeedbackItem[]> {
  const allItems: FeedbackItem[] = [];
  const seenTexts = new Set<string>();

  console.log('\n🎵 Scraping Spotify Community Forum...');

  for (const query of SPOTIFY_COMMUNITY_QUERIES) {
    console.log(`  → Searching: "${query}"`);

    try {
      const items = await scrapeCommunitySearchPage(query);

      for (const item of items) {
        const key = item.text.toLowerCase().slice(0, 80);
        if (!seenTexts.has(key)) {
          seenTexts.add(key);
          allItems.push(item);
        }
      }

      console.log(`    Found ${items.length} qualifying posts`);
      await sleep(1500); // polite crawl delay
    } catch (err: any) {
      console.error(`    ✗ Failed for "${query}": ${err.message}`);
    }
  }

  console.log(`  ✅ Spotify Community total: ${allItems.length} posts`);
  return allItems;
}

// ─── Combine & Export ─────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Starting combined feedback scrape...\n');

  // Run both scrapers (in parallel)
  const [youtubeItems, communityItems] = await Promise.allSettled([
    scrapeYouTube(),
    scrapeSpotifyCommunity(),
  ]);

  const combined: FeedbackItem[] = [];

  if (youtubeItems.status === 'fulfilled') {
    combined.push(...youtubeItems.value);
  } else {
    console.error(`\n❌ YouTube scraper failed: ${youtubeItems.reason}`);
  }

  if (communityItems.status === 'fulfilled') {
    combined.push(...communityItems.value);
  } else {
    console.error(`\n❌ Spotify Community scraper failed: ${communityItems.reason}`);
  }

  // Sort by engagement descending
  combined.sort((a, b) => b.engagement - a.engagement);

  // Write output
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(combined, null, 2), 'utf-8');

  console.log('\n─────────────────────────────────────────');
  console.log(`✅ Done! Total items collected: ${combined.length}`);
  console.log(`   YouTube comments : ${combined.filter(i => i.source === 'YouTube').length}`);
  console.log(`   Spotify Community: ${combined.filter(i => i.source === 'SpotifyCommunity').length}`);
  console.log(`   Output file      : ${OUTPUT_FILE}`);
  console.log('\n📋 Top 5 by engagement:');
  combined.slice(0, 5).forEach((item, i) => {
    console.log(`  ${i + 1}. [${item.source}] engagement=${item.engagement}`);
    console.log(`     "${item.text.slice(0, 100)}..."`);
  });
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
