import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const TARGET = "Recommendations don't match my actual taste";
const SAMPLE_SIZE = 30;

async function run() {
  const { getAllAnalyzedReviews, getAllRawReviews } = await import('../services/reviewService');
  const [analyzed, raw] = await Promise.all([getAllAnalyzedReviews(), getAllRawReviews()]);

  const rawById = new Map(raw.map(r => [r.id, r]));
  const matched = analyzed.filter(r => r.pain_point === TARGET);

  console.log(`\nTotal "${TARGET}": ${matched.length}\n`);

  const shuffled = [...matched].sort(() => Math.random() - 0.5);
  const samples = shuffled.slice(0, Math.min(SAMPLE_SIZE, shuffled.length));

  console.log(`── Sample of ${samples.length} random reviews ──\n`);
  samples.forEach((r, i) => {
    const raw = rawById.get(r.raw_review_id);
    const text = raw?.review_text ?? '(not found)';
    const platform = raw?.platform ?? 'unknown';
    console.log(`--- Sample ${i + 1} / ${samples.length} ---`);
    console.log(`Platform: ${platform}`);
    console.log(`Analyzed ID: ${r.id}`);
    console.log(`Raw text:\n${text}\n`);
  });
}

run().catch(console.error);
