export interface AnalysisSummary {
  totalReviews: number;
  totalAnalyzedReviews: number;
  sources: {
    PlayStore: number;
    AppStore: number;
    SpotifyCommunity: number;
  };
  topPainPoints: Array<{ name: string; count: number; percentage: number }>;
  topUserNeeds: Array<{ name: string; count: number; percentage: number }>;
  topThemes: Array<{ name: string; count: number; percentage: number }>;
  topDiscoveryBehaviors: Array<{ name: string; count: number; percentage: number }>;
  sentimentSplit: {
    positive: number;
    neutral: number;
    negative: number;
    positivePercentage: number;
    neutralPercentage: number;
    negativePercentage: number;
  };
  lastScrapedAt?: string | null;
}

