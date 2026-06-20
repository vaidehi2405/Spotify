import * as dotenv from 'dotenv';
import { resolve } from 'path';
import * as fs from 'fs';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import { getAllAnalyzedReviews, getAllRawReviews } from '../services/reviewService';
import { retrieveRelevantReviews } from '../services/askService';

async function main() {
  const analyzedReviews = await getAllAnalyzedReviews();
  const rawReviews = await getAllRawReviews();

  const queries = [
    "What's wrong with podcast recommendations?",
    "Why do users keep hearing the same songs?",
    "How do users feel about playlist creation?",
    "Are podcasts annoying users?"
  ];

  let output = '=== Retrieval Quality Verification (Threshold: 0.28) ===\n\n';

  for (const query of queries) {
    output += `QUERY: "${query}"\n`;
    output += '='.repeat(80) + '\n';

    // We can call retrieveRelevantReviews from askService, which will use the 0.28 threshold
    const results = retrieveRelevantReviews(query, analyzedReviews, rawReviews, 10);

    output += `Results found above threshold 0.28: ${results.length}\n`;
    if (results.length < 3) {
      output += '>>> THRESHOLD TRIGGERED: Less than 3 reviews clear 0.28. "Not enough relevant reviews found" message will show on UI.\n';
    } else {
      output += '>>> Normal display: Grounded AI answer will be generated using these reviews.\n';
    }
    output += '\n';

    if (results.length > 0) {
      results.forEach((res, idx) => {
        output += `[#${idx + 1}] Score: ${res.score.toFixed(4)}\n`;
        output += `    Theme      : ${res.analyzed.theme}\n`;
        output += `    Pain Point : ${res.analyzed.pain_point}\n`;
        output += `    Raw Text   : "${res.raw?.review_text || ''}"\n\n`;
      });
    } else {
      output += '(No reviews passed the 0.28 threshold)\n\n';
    }

    output += '='.repeat(80) + '\n\n';
  }

  const outputPath = resolve(__dirname, 'query_test_results.txt');
  fs.writeFileSync(outputPath, output);
  console.log(`Results written to ${outputPath}`);
}

main().catch(console.error);
