export interface ScrapeState {
  isScraping: boolean;
  lastScrapedAt: Date | null;
  stage: 'idle' | 'scraping' | 'classifying' | 'importing';
  totalPending: number;
  classifiedCount: number;
  error: string | null;
  estimatedDuration?: number | null;
  estimatedTimeRemaining?: number | null;
  cancelled: boolean;
}

export const scrapeState: ScrapeState = {
  isScraping: false,
  lastScrapedAt: null,
  stage: 'idle',
  totalPending: 0,
  classifiedCount: 0,
  error: null,
  estimatedDuration: null,
  estimatedTimeRemaining: null,
  cancelled: false,
};
