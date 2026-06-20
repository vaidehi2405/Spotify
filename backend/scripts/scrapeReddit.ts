/**
 * scrapeReddit.ts
 * ---------------
 * Scrapes posts + top-level comments from r/spotify and r/Music
 * using Reddit's public /.json endpoints — no API key required.
 *
 * Filters:
 *  - Keywords: "music discovery", "recommendations", "discover weekly",
 *              "algorithm", "playlist", "suggestions"
 *  - Minimum post score: 50
 *  - Date range: past 90 days
 *
 * Usage:  npx ts-node scripts/scrapeReddit.ts
 */

import * as dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import { supabaseAdmin } from '../lib/supabaseAdmin';

// ─── Config ──────────────────────────────────────────────────────────────────

const SUBREDDITS = ['spotify', 'Music'];

const KEYWORDS = [
  'music discovery',
  'discover weekly',
  'recommendations',
  'algorithm',
  'daily mix',
  'smart shuffle',
  'release radar',
  'playlist suggestions',
  'new music',
];

const MIN_SCORE = 50;
const DAYS_BACK = 90;
const CUTOFF_TIMESTAMP = Math.floor(Date.now() / 1000) - DAYS_BACK * 24 * 60 * 60;

// Reddit throttles aggressively without a proper User-Agent
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; SpotifyResearchBot/1.0; +https://github.com/research)',
  'Accept': 'application/json',
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  score: number;
  created_utc: number;
  url: string;
  num_comments: number;
  subreddit: string;
}

interface RedditComment {
  id: string;
  body: string;
  score: number;
  created_utc: number;
}

interface ScrapedReview {
  external_id: string;
  platform: string;
  review_text: string;
  score: number;
  scraped_at: string;
  source_url: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Polite delay to avoid hitting Reddit's rate limiter */
function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Check if the post text contains any of our target keywords */
function matchesKeywords(text: string): boolean {
  const lower = text.toLowerCase();
  return KEYWORDS.some(kw => lower.includes(kw));
}

/** Fetch JSON from a Reddit public endpoint with retries */
async function redditFetch(url: string, retries = 3): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });

      if (res.status === 429) {
        const wait = attempt * 5000;
        console.warn(`  ⚠ Rate limited. Waiting ${wait / 1000}s before retry...`);
        await sleep(wait);
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }

      return await res.json();
    } catch (err: any) {
      if (attempt === retries) throw err;
      console.warn(`  ⚠ Attempt ${attempt} failed: ${err.message}. Retrying...`);
      await sleep(2000 * attempt);
    }
  }
}

// ─── Core Scrapers ───────────────────────────────────────────────────────────

/**
 * Fetches top-level comments from a Reddit post.
 * Returns the body text of comments with score > 5.
 */
async function fetchComments(subreddit: string, postId: string): Promise<string[]> {
  await sleep(1500); // polite delay between requests

  const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}.json?limit=20&depth=1`;
  const data = await redditFetch(url);

  if (!Array.isArray(data) || data.length < 2) return [];

  const commentListing = data[1]?.data?.children ?? [];

  return commentListing
    .filter((c: any) => {
      const d = c.data;
      return (
        c.kind === 't1' &&
        d.body &&
        d.body !== '[deleted]' &&
        d.body !== '[removed]' &&
        d.score >= 5 &&
        d.body.length > 30
      );
    })
    .map((c: any) => c.data.body as string);
}

/**
 * Searches a subreddit for posts matching a keyword query.
 * Uses Reddit's public search endpoint.
 */
async function searchSubreddit(subreddit: string, query: string): Promise<RedditPost[]> {
  const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=relevance&t=year&limit=25`;
  const data = await redditFetch(url);

  const children = data?.data?.children ?? [];

  return children
    .map((c: any) => c.data as RedditPost)
    .filter((post: RedditPost) => {
      return (
        post.score >= MIN_SCORE &&
        post.created_utc >= CUTOFF_TIMESTAMP &&
        post.selftext !== '[deleted]' &&
        post.selftext !== '[removed]'
      );
    });
}

// ─── Main Scrape Function ─────────────────────────────────────────────────────

export async function scrapeReddit(): Promise<ScrapedReview[]> {
  const allReviews: ScrapedReview[] = [];
  const seenPostIds = new Set<string>();

  console.log('\n🔍 Starting Reddit scrape...');
  console.log(`   Subreddits : ${SUBREDDITS.join(', ')}`);
  console.log(`   Keywords   : ${KEYWORDS.length} terms`);
  console.log(`   Min score  : ${MIN_SCORE}`);
  console.log(`   Date range : last ${DAYS_BACK} days\n`);

  for (const subreddit of SUBREDDITS) {
    for (const keyword of KEYWORDS) {
      console.log(`  → Searching r/${subreddit} for "${keyword}"...`);

      let posts: RedditPost[] = [];
      try {
        posts = await searchSubreddit(subreddit, keyword);
      } catch (err: any) {
        console.error(`     ✗ Failed: ${err.message}`);
        continue;
      }

      console.log(`     Found ${posts.length} qualifying posts`);

      for (const post of posts) {
        if (seenPostIds.has(post.id)) continue;
        seenPostIds.add(post.id);

        const postText = [post.title, post.selftext].filter(Boolean).join('\n\n').trim();

        if (!matchesKeywords(postText) && !matchesKeywords(post.title)) continue;

        // Add the post itself as a review entry
        if (postText.length > 20) {
          allReviews.push({
            external_id: `reddit_post_${post.id}`,
            platform: 'Reddit',
            review_text: postText,
            score: post.score,
            scraped_at: new Date().toISOString(),
            source_url: `https://reddit.com${post.url}`,
          });
        }

        // Fetch and add top-level comments
        try {
          const comments = await fetchComments(subreddit, post.id);
          for (const [i, comment] of comments.entries()) {
            if (!matchesKeywords(comment) && i > 2) continue; // keep top 3 regardless
            allReviews.push({
              external_id: `reddit_comment_${post.id}_${i}`,
              platform: 'Reddit',
              review_text: comment,
              score: post.score,
              scraped_at: new Date().toISOString(),
              source_url: `https://reddit.com${post.url}`,
            });
          }
        } catch (err: any) {
          console.warn(`     ⚠ Could not fetch comments for post ${post.id}: ${err.message}`);
        }
      }

      await sleep(1000); // polite pause between keyword searches
    }
  }

  console.log(`\n✅ Reddit scrape complete. Total entries: ${allReviews.length}`);
  return allReviews;
}

// ─── Supabase Insert ─────────────────────────────────────────────────────────

async function saveToSupabase(reviews: ScrapedReview[]) {
  if (reviews.length === 0) {
    console.log('No new reviews to save.');
    return;
  }

  console.log(`\n💾 Saving ${reviews.length} entries to Supabase...`);

  // Insert in batches of 50 to avoid payload limits
  const BATCH_SIZE = 50;
  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < reviews.length; i += BATCH_SIZE) {
    const batch = reviews.slice(i, i + BATCH_SIZE);

    // Map to raw_reviews schema (use external_id for deduplication)
    const rows = batch.map(r => ({
      platform: r.platform,
      review_text: r.review_text,
      external_id: r.external_id,
      source_url: r.source_url,
      scraped_at: r.scraped_at,
    }));

    const { data, error } = await supabaseAdmin
      .from('raw_reviews')
      .upsert(rows, { onConflict: 'external_id', ignoreDuplicates: true });

    if (error) {
      console.error(`  ✗ Batch ${Math.ceil(i / BATCH_SIZE) + 1} error:`, error.message);
    } else {
      inserted += batch.length;
      console.log(`  ✓ Batch ${Math.ceil(i / BATCH_SIZE) + 1}: saved ${batch.length} rows`);
    }
  }

  console.log(`\n📊 Done. Inserted/updated: ${inserted} | Skipped duplicates: ${skipped}`);
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

async function main() {
  try {
    const reviews = await scrapeReddit();

    // Print preview of scraped text
    console.log('\n--- Preview (first 3 entries) ---');
    reviews.slice(0, 3).forEach((r, i) => {
      console.log(`\n[${i + 1}] ${r.external_id} (score: ${r.score})`);
      console.log(r.review_text.slice(0, 200) + (r.review_text.length > 200 ? '...' : ''));
    });

    await saveToSupabase(reviews);
  } catch (err: any) {
    console.error('Fatal error:', err.message);
    process.exit(1);
  }
}

main();
