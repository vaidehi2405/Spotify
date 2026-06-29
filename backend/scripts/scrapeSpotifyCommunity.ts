/**
 * scrapeSpotifyCommunity.ts
 * Scrapes Spotify Community forum discussions (titles + post bodies + replies).
 * No API key required.
 */

import * as dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import axios from 'axios';
import * as cheerio from 'cheerio';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { ScrapedReview } from './scrapePlayStore';

const COMMUNITY_BASE = 'https://community.spotify.com';

const SEARCH_QUERIES = [
  'music discovery',
  'recommendations',
  'discover weekly',
  'algorithm',
  'daily mix',
  'playlist suggestions',
  'on repeat',
  'release radar',
];

const BOARD_URLS = [
  `${COMMUNITY_BASE}/t5/Discovery-Promo/bd-p/discovery_and_promo`,
  `${COMMUNITY_BASE}/t5/Content-Questions/bd-p/content`,
  `${COMMUNITY_BASE}/t5/Your-Library/bd-p/yourlibrary`,
  `${COMMUNITY_BASE}/t5/Music-Discussion/bd-p/music_discussion`,
  `${COMMUNITY_BASE}/t5/App-Features/bd-p/app_and_features`,
];

const DISCOVERY_KEYWORDS = [
  'discover', 'recommend', 'algorithm', 'playlist', 'daily mix',
  'discover weekly', 'release radar', 'on repeat', 'suggestion', 'wrapped',
  'new music', 'artist', 'radio', 'dj', 'mix', 'feed', 'home',
];

const MAX_THREADS = 60;
const MAX_REPLIES_PER_THREAD = 4;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function cleanText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function threadIdFromUrl(url: string): string | null {
  const match = url.match(/\/td-p\/(\d+)/);
  return match ? match[1] : null;
}

function normalizeThreadUrl(href: string): string {
  const path = href.startsWith('http') ? href.replace(COMMUNITY_BASE, '') : href;
  const id = threadIdFromUrl(path);
  return id ? `${COMMUNITY_BASE}${path.split('?')[0]}` : href.startsWith('http') ? href : `${COMMUNITY_BASE}${href}`;
}

function isDiscoveryRelevant(text: string): boolean {
  const lower = text.toLowerCase();
  return DISCOVERY_KEYWORDS.some(kw => lower.includes(kw));
}

function extractThreadLinks(html: string): Array<{ url: string; title: string }> {
  const $ = cheerio.load(html);
  const threads: Array<{ url: string; title: string }> = [];
  const seen = new Set<string>();

  $('a[href*="/td-p/"]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const text = cleanText($(el).text())
      .replace(/^Read more about "/i, '')
      .replace(/"$/i, '')
      .replace(/^(Solved!!|Superuser Contribution)\s*/gi, '');

    const threadId = threadIdFromUrl(href);
    if (!threadId || text.length < 12 || seen.has(threadId)) return;

    seen.add(threadId);
    threads.push({
      url: normalizeThreadUrl(href),
      title: text,
    });
  });

  return threads;
}

async function fetchHtml(url: string): Promise<string> {
  const { data } = await axios.get(url, { headers: HEADERS, timeout: 20000 });
  return data;
}

async function scrapeListingPage(url: string, requireKeyword = false): Promise<Array<{ url: string; title: string }>> {
  const html = await fetchHtml(url);
  const threads = extractThreadLinks(html);
  if (!requireKeyword) return threads;
  return threads.filter(t => isDiscoveryRelevant(t.title));
}

async function scrapeSearchPage(query: string): Promise<Array<{ url: string; title: string }>> {
  const url = `${COMMUNITY_BASE}/t5/forums/searchpage/tab/message?q=${encodeURIComponent(query)}&filter=location&location=category:English&search_type=thread`;
  return scrapeListingPage(url, false);
}

async function scrapeThreadDiscussion(
  threadUrl: string,
  fallbackTitle: string
): Promise<{ review: ScrapedReview | null; postedAt: Date | null }> {
  const threadId = threadIdFromUrl(threadUrl);
  if (!threadId) return { review: null, postedAt: null };

  const html = await fetchHtml(threadUrl);
  const $ = cheerio.load(html);

  const pageTitle = cleanText(
    $('h1.lia-message-subject, .lia-message-subject, h1.page-title, h1').first().text() || fallbackTitle
  );

  const bodies: string[] = [];
  $('.lia-message-body-content').each((_, el) => {
    const text = cleanText($(el).text())
      .replace(/Solved!\s*Go to Solution\.?/gi, '')
      .replace(/Superuser Contribution/gi, '');
    if (text.length > 20) bodies.push(text);
  });

  // Extract posted date from first message
  let postedAt: Date | null = null;
  const timeElement = $('time').first();
  if (timeElement.length > 0) {
    const datetime = timeElement.attr('datetime');
    if (datetime) postedAt = new Date(datetime);
  }
  if (!postedAt) {
    const dateText = $('.lia-message-posted-date').first().text().trim();
    if (dateText) {
      // Clean non-printable characters
      const cleaned = dateText.replace(/[^\x20-\x7E]/g, '').trim();
      const parsed = Date.parse(cleaned);
      if (!isNaN(parsed)) postedAt = new Date(parsed);
    }
  }

  if (bodies.length === 0) {
    const titleOnly = pageTitle || fallbackTitle;
    if (titleOnly.length < 15) return { review: null, postedAt };
    bodies.push(titleOnly);
  }

  const opener = bodies[0];
  const replies = bodies.slice(1, 1 + MAX_REPLIES_PER_THREAD);

  let reviewText = `Title: ${pageTitle || fallbackTitle}\n\n${opener}`;
  if (replies.length > 0) {
    reviewText += `\n\n--- Community replies ---\n${replies.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
  }

  return {
    review: {
      external_id: `community_${threadId}`,
      source: 'Spotify Community',
      platform: 'Spotify Community',
      review_text: reviewText,
      scraped_at: new Date().toISOString(),
      source_url: threadUrl,
    },
    postedAt
  };
}

export async function scrapeSpotifyCommunity(since?: Date): Promise<ScrapedReview[]> {
  const threadMap = new Map<string, { url: string; title: string }>();

  console.log('\n🎵 Scraping Spotify Community Forum...');

  // Fetch existing external_ids from database to prevent duplicate thread scraping
  let existingIds = new Set<string>();
  try {
    const { data: existingRows } = await supabaseAdmin
      .from('raw_reviews')
      .select('external_id')
      .eq('source', 'Spotify Community');
    existingIds = new Set((existingRows || []).map((r: any) => r.external_id));
  } catch (err: any) {
    console.error('  [Community] Failed to fetch existing external_ids:', err.message);
  }

  for (const query of SEARCH_QUERIES) {
    console.log(`  → Searching: "${query}"`);
    try {
      const threads = await scrapeSearchPage(query);
      for (const thread of threads) {
        const id = threadIdFromUrl(thread.url);
        if (id) {
          const extId = `community_${id}`;
          if (!threadMap.has(id) && !existingIds.has(extId)) {
            threadMap.set(id, thread);
          }
        }
      }
      console.log(`    Found ${threads.length} threads`);
    } catch (err: any) {
      console.error(`    ✗ Search failed: ${err.message}`);
    }
    await sleep(1200);
  }

  for (const boardUrl of BOARD_URLS) {
    console.log(`  → Board: ${boardUrl.split('/t5/')[1]?.split('/')[0] ?? boardUrl}`);
    try {
      const threads = await scrapeListingPage(boardUrl, true);
      for (const thread of threads) {
        const id = threadIdFromUrl(thread.url);
        if (id) {
          const extId = `community_${id}`;
          if (!threadMap.has(id) && !existingIds.has(extId)) {
            threadMap.set(id, thread);
          }
        }
      }
      console.log(`    Found ${threads.length} relevant threads`);
    } catch (err: any) {
      console.error(`    ✗ Board failed: ${err.message}`);
    }
    await sleep(1200);
  }

  const candidates = Array.from(threadMap.values()).slice(0, MAX_THREADS);
  console.log(`  → Fetching ${candidates.length} discussion threads...`);

  const allReviews: ScrapedReview[] = [];

  for (const [index, thread] of candidates.entries()) {
    try {
      const { review, postedAt } = await scrapeThreadDiscussion(thread.url, thread.title);
      if (review && review.review_text.length > 30) {
        if (since && postedAt && postedAt.getTime() <= since.getTime()) {
          console.log(`    → Skipping thread posted on ${postedAt.toISOString()} (older than since date)`);
          continue;
        }
        allReviews.push(review);
      }
    } catch (err: any) {
      console.error(`    ✗ Thread ${index + 1} failed: ${err.message}`);
    }
    await sleep(800);
  }

  console.log(`  ✅ Community total: ${allReviews.length} discussions`);
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
  console.log(`  💾 Saved ${reviews.length} Community discussions to Supabase`);
}

if (require.main === module) {
  scrapeSpotifyCommunity().then(saveToSupabase).catch(console.error);
}
