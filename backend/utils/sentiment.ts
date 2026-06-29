export type ReviewSentiment = 'positive' | 'neutral' | 'negative';

const POSITIVE_PATTERNS = [
  /\blove\b/i,
  /\bloved\b/i,
  /\bloving\b/i,
  /\blike\b/i,
  /\bliked\b/i,
  /\benjoy\b/i,
  /\benjoying\b/i,
  /\bgreat\b/i,
  /\bgood\b/i,
  /\bbest\b/i,
  /\bbetter\b/i,
  /\bfavo(?:u)?rite\b/i,
  /\bawesome\b/i,
  /\bamazing\b/i,
  /\bexcellent\b/i,
  /\bperr?fect(?:o)?\b/i,
  /\buseful\b/i,
  /\bsolid\b/i,
  /\bnice\b/i,
  /\bfresh\b/i,
  /\bhappy\b/i,
  /\bglad\b/i,
  /\bclassic\b/i,
  /\bsave time\b/i,
  /\bhelp(?:s|ed)? me\b/i,
  /\bsatisf(?:y|ied|action)\b/i,
  /\bpart of my life\b/i,
  /\bpeak\b/i,
  /\bfire\b/i,
  /\brecommend\b/i,
  /\brecomended\b/i,
  /\brecommened\b/i,
  /\beasy to use\b/i,
  /\beasier to use\b/i,
  /\breads my mind\b/i,
  /\bno competitor\b/i,
  /\bcouldn'?t live without\b/i,
  /\bhands down the best\b/i,
  /\buser since\b/i,
  /\buser for\b/i,
  /\bnever switch\b/i,
  /\bnever use anything else\b/i,
  /\bI'll ever use\b/i,
  /\bI will ever use\b/i,
  /\blocked in\b/i,
  /\bcool\b/i,
  /\bperfection\b/i,
  /\bto die for\b/i,
  /\bwould recommend\b/i,
  /\bhighly recommend\b/i,
  /👍/u,
  /👌/u,
  /❤️/u,
  /🔥/u,
  /😍/u,
  /😊/u,
  /🥰/u,
];

const NEGATIVE_PATTERNS = [
  /\bhate\b/i,
  /\bbad\b/i,
  /\bso bad\b/i,
  /\bworst\b/i,
  /\bsucks?\b/i,
  /\bterrible\b/i,
  /\bawful\b/i,
  /\bannoy(?:ing|ed)?\b/i,
  /\bfrustrat(?:ing|ed|ion)?\b/i,
  /\btrash(?:y)?\b/i,
  /\bgarbage\b/i,
  /\bbroken\b/i,
  /\bdoesn'?t work\b/i,
  /\bnot working\b/i,
  /\bunusable\b/i,
  /\bcrash(?:es|ing|ed)?\b/i,
  /\btoo many ads\b/i,
  /\bads?\b/i,
  /\bpayment\b/i,
  /\bbilling\b/i,
  /\brefund\b/i,
  /\bdon'?t recommend\b/i,
  /\bnot recommend\b/i,
  /\bnever recommend\b/i,
  /\bdo not recommend\b/i,
  /\bno recommendation\b/i,
];

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

export function normalizeSentimentFromText(
  reviewText: string,
  modelSentiment: string | null | undefined,
  rating?: number | null
): ReviewSentiment {
  // If a valid numerical rating is provided, let it guide the sentiment
  if (rating !== undefined && rating !== null) {
    if (rating >= 4) return 'positive';
    if (rating <= 2) return 'negative';
  }

  const normalizedModelSentiment = String(modelSentiment || '').toLowerCase();
  const fallback: ReviewSentiment =
    normalizedModelSentiment === 'positive' || normalizedModelSentiment === 'neutral' || normalizedModelSentiment === 'negative'
      ? normalizedModelSentiment
      : 'neutral';

  const positiveScore = countMatches(reviewText, POSITIVE_PATTERNS);
  const negativeScore = countMatches(reviewText, NEGATIVE_PATTERNS);

  if (positiveScore > 0 && negativeScore === 0) return 'positive';
  if (negativeScore > 0 && positiveScore === 0) return 'negative';
  if (positiveScore > 0 && negativeScore > 0) {
    if (fallback === 'positive' || fallback === 'negative') return fallback;
    return 'neutral';
  }

  return fallback;
}
