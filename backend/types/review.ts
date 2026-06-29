export interface RawReview {
  id: string;
  source: string;
  platform: string;
  review_text: string;
  rating: number | null;
  review_url: string | null;
  posted_at: string | null;
  external_id?: string;
  created_at?: string;
}

export interface AnalyzedReview {
  id: string;
  raw_review_id: string;
  pain_point: string | null;
  discovery_behavior: string | null;
  user_need: string | null;
  sentiment: string | null;
  theme: string | null;
  summary: string | null;
  confidence: string | null;
  created_at?: string;
}
