import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

// The mock always writes confidence="medium" and one of these specific user_need strings.
// Real Groq classifications never match these exact strings (they vary per review).
// After second-pass:
//   - not_relevant → confidence flipped to "high"   → these are already fixed, skip them
//   - others still have confidence="medium" if untouched by second-pass, OR were re-set to
//     a sub-reason by second-pass (still medium if mock ran again) — both need re-analysis
// Strategy: confidence=medium AND user_need in specific mock set (NOT 'not_relevant')
const MOCK_USER_NEEDS_SPECIFIC = new Set([
  'More accurate and high-quality recommendation algorithms.',
  'Greater variety and freshness in music suggestions.',
  'New tools and options to search and filter discoveries.',
  'Truly fresh and obscure music recommendations in weekly discovery.',
  'A more random or customized shuffle feature.',
  'Unique Daily Mixes with less overlap and higher track variety.',
  'Fine-grained controls (like obscurity sliders) to tweak the recommendation engine.',
  'Accurate and comprehensive tracking of new music from followed indie artists.',
  'Radios that branch out and discover similar but unfamiliar artists.',
  'Option to hide or separate podcast recommendations.',
  'Better visibility and recommendations of lesser-known indie artists.',
  'More diverse autoplay that explores outside recent history.',
  "A 'dislike' or 'block' button to train the algorithm.",
  'Separation between liked songs and new discovery streams.',
  'Incognito listening mode or ability to reset taste profile.',
  'Accurate genre and mood categorization in auto-generated mixes.',
  'Algorithm that bridges genres and breaks out of bubbles.',
  "Context-aware recommendations that fit the playlist's mood.",
]);

async function run() {
  const { getAllAnalyzedReviews } = await import('../services/reviewService');
  const analyzed = await getAllAnalyzedReviews();

  // Only reviews with confidence=medium AND specific mock user_need (not not_relevant)
  const mockReviews = analyzed.filter(ar => {
    if (ar.confidence?.toLowerCase() !== 'medium') return false;
    if (!ar.user_need) return false;
    return MOCK_USER_NEEDS_SPECIFIC.has(ar.user_need.trim());
  });

  console.log(`Total analyzed reviews: ${analyzed.length}`);
  console.log(`Mock-classified reviews to re-analyze: ${mockReviews.length}`);

  const byPainPoint: Record<string, number> = {};
  for (const r of mockReviews) {
    const pp = r.pain_point ?? '(null)';
    byPainPoint[pp] = (byPainPoint[pp] || 0) + 1;
  }
  const sorted = Object.entries(byPainPoint).sort((a, b) => b[1] - a[1]);
  console.log('\nBreakdown by pain_point:');
  for (const [pp, cnt] of sorted) {
    console.log(`  ${cnt.toString().padStart(4)}  ${pp}`);
  }
}

run().catch(console.error);
