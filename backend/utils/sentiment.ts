export type ReviewSentiment = 'positive' | 'neutral' | 'negative';

const POSITIVE_PATTERNS = [
  /\blove\b/i,
  /\bloved\b/i,
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
  /\bperfect\b/i,
  /\bsolid\b/i,
  /\beasy to use\b/i,
  /\beasier to use\b/i,
  /\breads my mind\b/i,
  /\bno competitor\b/i,
  /\bcouldn'?t live without\b/i,
  /\bhands down the best\b/i,
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
];

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

export function normalizeSentimentFromText(reviewText: string, modelSentiment: string | null | undefined): ReviewSentiment {
  const normalizedModelSentiment = String(modelSentiment || '').toLowerCase();
  const fallback: ReviewSentiment =
    normalizedModelSentiment === 'positive' || normalizedModelSentiment === 'neutral' || normalizedModelSentiment === 'negative'
      ? normalizedModelSentiment
      : 'neutral';

  const positiveScore = countMatches(reviewText, POSITIVE_PATTERNS);
  const negativeScore = countMatches(reviewText, NEGATIVE_PATTERNS);

  if (positiveScore > 0 && negativeScore === 0) return 'positive';
  if (negativeScore > 0 && positiveScore === 0) return 'negative';
  if (positiveScore > 0 && negativeScore > 0) return 'neutral';

  return fallback;
}
