import { AnalyzedReview } from './review';

export interface AskQuestionRequest {
  question: string;
}

export interface AskDebugInfo {
  intent: 'narrow' | 'broad' | 'off_topic';
  selected_pain_points: string[];
  selected_themes: string[];
  rationale: string;
  category_counts: Array<{ name: string; count: number }>;
  sampled_reviews: Array<{
    id: string;
    platform: string;
    pain_point: string | null;
    theme: string | null;
    text_preview: string;
  }>;
  generated_answer: string;
  generated_answer_points: string[];
}

export interface AskQuestionResponse {
  answer: string;
  answer_points: string[];
  source_counts: {
    PlayStore: number;
    AppStore: number;
    SpotifyCommunity: number;
  };
  supporting_reviews: (AnalyzedReview & { review_text?: string })[];
  debug?: AskDebugInfo;
}
