import { supabaseAdmin } from '../lib/supabaseAdmin';
import { RawReview, AnalyzedReview } from '../types/review';

export async function getUnanalyzedReviews(): Promise<RawReview[]> {
  const allData: any[] = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from('raw_reviews')
      .select(`
        *,
        analyzed_reviews (id)
      `)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.error('Error fetching unanalyzed reviews:', error);
      return [];
    }

    if (!data || data.length === 0) {
      break;
    }

    allData.push(...data);
    if (data.length < pageSize) {
      break;
    }
    page++;
  }

  // Filter out reviews that already have an analyzed_review entry
  return allData.filter(review => !review.analyzed_reviews || review.analyzed_reviews.length === 0);
}

export async function saveAnalyzedReview(analyzedData: Omit<AnalyzedReview, 'id' | 'created_at'>): Promise<void> {
  // Prevent duplicate analyzed rows by removing any existing entry for this raw_review_id
  await supabaseAdmin
    .from('analyzed_reviews')
    .delete()
    .eq('raw_review_id', analyzedData.raw_review_id);

  const { error } = await supabaseAdmin
    .from('analyzed_reviews')
    .insert([analyzedData]);

  if (error) {
    console.error('Error saving analyzed review:', error);
  }
}

export async function getAllAnalyzedReviews(): Promise<AnalyzedReview[]> {
  const allData: AnalyzedReview[] = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from('analyzed_reviews')
      .select('*')
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.error('Error fetching analyzed reviews:', error);
      return allData;
    }

    if (!data || data.length === 0) {
      break;
    }

    allData.push(...data);
    if (data.length < pageSize) {
      break;
    }
    page++;
  }

  return allData;
}

export async function getAllRawReviews(): Promise<RawReview[]> {
  const allData: RawReview[] = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from('raw_reviews')
      .select('*')
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.error('Error fetching raw reviews:', error);
      return allData;
    }

    if (!data || data.length === 0) {
      break;
    }

    allData.push(...data);
    if (data.length < pageSize) {
      break;
    }
    page++;
  }

  return allData;
}

export async function updateAnalyzedReviewPainPoint(
  analyzedReviewId: string,
  pain_point: string,
  confidence?: string
): Promise<void> {
  const updates: Partial<AnalyzedReview> = { pain_point };
  if (confidence) {
    updates.confidence = confidence;
  }

  const { error } = await supabaseAdmin
    .from('analyzed_reviews')
    .update(updates)
    .eq('id', analyzedReviewId);

  if (error) {
    console.error('Error updating analyzed review pain point:', error);
  }
}
