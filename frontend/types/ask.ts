import { AnalyzedReview } from './review';

export interface AskQuestionRequest {
  question: string;
}

export interface AskQuestionResponse {
  answer: string;
  source_counts: {
    PlayStore: number;
    AppStore: number;
    SpotifyCommunity: number;
  };
  supporting_reviews: AnalyzedReview[];
}
