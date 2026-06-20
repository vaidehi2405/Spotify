import { AnalyzedReview } from './review';

export interface AskQuestionRequest {
  question: string;
}

export interface AskQuestionResponse {
  answer: string;
  answer_points: string[];
  source_counts: {
    PlayStore: number;
    AppStore: number;
  };
  supporting_reviews: (AnalyzedReview & { review_text?: string })[];
}
