import { AnalyzedReview } from './review';

export interface AskQuestionRequest {
  question: string;
}

export interface AskQuestionResponse {
  answer: string;
  source_counts: {
    Reddit: number;
    PlayStore: number;
    AppStore: number;
  };
  supporting_reviews: AnalyzedReview[];
}
