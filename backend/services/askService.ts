import { getAllAnalyzedReviews, getAllRawReviews } from './reviewService';
import { callGroqAPI } from '../lib/groqClient';
import { askAnswerSystemPrompt } from '../prompts/askAnswerPrompt';
import { AskQuestionResponse } from '../types/ask';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { RawReview, AnalyzedReview } from '../types/review';

function stem(word: string): string {
  let w = word.toLowerCase().trim();
  if (w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.endsWith('ing')) w = w.slice(0, -3);
  if (w.endsWith('ed')) w = w.slice(0, -2);
  if (w.endsWith('ive')) w = w.slice(0, -3) + 'e';
  if (w.endsWith('tion')) w = w.slice(0, -4);
  
  if (w.startsWith('repeti') || w.startsWith('repeat')) return 'repeat';
  if (w.startsWith('recommend')) return 'recommend';
  if (w.startsWith('discover')) return 'discover';
  if (w.startsWith('suggest')) return 'suggest';
  if (w.startsWith('playlist')) return 'playlist';
  if (w.startsWith('song') || w.startsWith('track')) return 'song';
  if (w.startsWith('algorithm')) return 'algorithm';
  if (w.startsWith('crea')) return 'creat';
  if (w.startsWith('podcast')) return 'podcast';
  
  return w;
}

function tokenize(text: string): string[] {
  if (!text) return [];
  const stopwords = new Set([
    'the', 'and', 'to', 'of', 'in', 'i', 'is', 'that', 'it', 'on', 'you', 'this',
    'for', 'but', 'with', 'a', 'an', 'or', 'about', 'why', 'do', 'are', 'what',
    'who', 'how', 'where', 'when', 'which', 'be', 'been', 'was', 'were', 'has',
    'have', 'had', 'does', 'did', 'feel', 'users', 'about', 'from', 'by', 'at',
    'keep', 'keeps', 'hear', 'hearing', 'listen', 'listening', 'get', 'gets', 'app', 'spotify', 'music'
  ]);
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(word => word.length > 1 && !stopwords.has(word))
    .map(stem);
}

function getTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }
  return tf;
}

interface ScoredReview {
  analyzed: AnalyzedReview;
  raw: RawReview | undefined;
  score: number;
}

export function retrieveRelevantReviews(
  query: string,
  analyzedReviews: AnalyzedReview[],
  rawReviews: RawReview[],
  limit = 10
): ScoredReview[] {
  // Build a lookup map for raw reviews by id for O(1) access
  const rawMap = new Map<string, RawReview>();
  for (const r of rawReviews) {
    rawMap.set(r.id, r);
  }

  // Exclude reviews where pain_point is "not_relevant"
  const candidates = analyzedReviews.filter(r => r.pain_point !== 'not_relevant');

  // Use ONLY the raw review_text for the TF-IDF document corpus.
  // The analyzed fields (pain_point, summary, theme) use identical boilerplate
  // per theme (e.g., every "Podcasts" review has the same pain_point text),
  // which defeats score discrimination. Raw text provides genuine variation
  // between reviews that merely mention a topic vs. those that are actually
  // about it.
  const docTexts = candidates.map(r => {
    const raw = rawMap.get(r.raw_review_id);
    return (raw?.review_text || '').trim();
  });

  const docTokens = docTexts.map(text => tokenize(text));
  const docCount = docTokens.length;

  const df = new Map<string, number>();
  for (const tokens of docTokens) {
    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      df.set(token, (df.get(token) || 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [word, count] of df.entries()) {
    idf.set(word, Math.log((1 + docCount) / (1 + count)) + 1);
  }

  const embed = (tokens: string[]): Map<string, number> => {
    const tf = getTF(tokens);
    const vector = new Map<string, number>();
    for (const [word, count] of tf.entries()) {
      const wordIdf = idf.get(word) || 1;
      vector.set(word, count * wordIdf);
    }
    return vector;
  };

  const queryTokens = tokenize(query);
  const queryVector = embed(queryTokens);

  const COMPLAINT_WORDS = new Set([
    'annoy', 'wrong', 'problem', 'issue', 'broke', 'broken', 'terribl', 'terrible', 'worst', 'bad', 'disappoint', 'frustrat', 'garbage', 'trash', 'hate', 'clutter'
  ]);
  const isComplaintQuery = queryTokens.some(t => COMPLAINT_WORDS.has(t));

  const TOPIC_TERMS = new Set([
    'podcast', 'playlist', 'shuffle', 'dj', 'ad', 'premium', 'song', 'artist', 'mix', 'widget', 'radar', 'recommend', 'discover', 'suggest', 'music'
  ]);
  const queryTopics = queryTokens.filter(t => TOPIC_TERMS.has(t));

  const scoredReviews: ScoredReview[] = candidates.map((r, index) => {
    const raw = rawMap.get(r.raw_review_id);
    const reviewTokens = docTokens[index];

    // If the query contains topic terms, the review must match at least one of them
    let topicMatch = true;
    if (queryTopics.length > 0) {
      topicMatch = reviewTokens.some(t => queryTopics.includes(t));
    }

    let score = 0;
    if (topicMatch) {
      const reviewVector = embed(reviewTokens);
      let dotProduct = 0;
      let normQuery = 0;
      let normReview = 0;

      for (const [word, qVal] of queryVector.entries()) {
        const rVal = reviewVector.get(word) || 0;
        dotProduct += qVal * rVal;
        normQuery += qVal * qVal;
      }

      for (const rVal of reviewVector.values()) {
        normReview += rVal * rVal;
      }

      score = (normQuery === 0 || normReview === 0) 
        ? 0 
        : dotProduct / (Math.sqrt(normQuery) * Math.sqrt(normReview));

      // Deboost positive reviews for complaint queries
      const isPositiveSentiment = r.sentiment?.toLowerCase() === 'positive' ||
        (r.sentiment?.toLowerCase() === 'neutral' && /\b(love|great|good|best|like|happy)\b/i.test(raw?.review_text || ''));
      if (isComplaintQuery && isPositiveSentiment) {
        score *= 0.5;
      }
    }

    return {
      analyzed: r,
      raw,
      score
    };
  });

  // Exclude reviews below cosine similarity threshold (0.28)
  const threshold = 0.28;
  const results = scoredReviews
    .filter(res => res.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Log scores for diagnostics
  console.log(`[retrieveRelevantReviews] query="${query}" | ${results.length} results above threshold ${threshold}`);
  results.forEach((r, i) => {
    console.log(`  #${i + 1} [score: ${r.score.toFixed(4)}] theme="${r.analyzed.theme}" text="${(r.raw?.review_text || '').slice(0, 80)}..."`);
  });

  return results;
}

export async function expandQuery(question: string): Promise<string> {
  // If it's a very short conversational phrase, skip expansion
  const conversationalWords = new Set(['hi', 'hello', 'hey', 'thanks', 'thank you', 'ok', 'cool']);
  if (conversationalWords.has(question.toLowerCase().trim())) {
    return '';
  }

  const prompt = `Expand this user search question into 5-8 related keywords, search terms, and synonyms that might appear in user reviews about this topic. Return only a comma-separated list of keywords.

User question: "${question}"`;

  const systemPrompt = "You are a query expansion assistant. Expand the user's question into 5 to 8 related keywords, synonyms, and search terms that are likely to appear in user feedback or App Store/Play Store reviews about this topic. Keep the output extremely simple: return ONLY a comma-separated list of the keywords. Do not include introductory text, explanations, numbering, or bullet points.";

  try {
    const response = await callGroqAPI(prompt, systemPrompt);
    return response.trim().replace(/^["']|["']$/g, '').trim();
  } catch (err: any) {
    console.warn('[askService] Failed to expand query:', err.message);
    return '';
  }
}

export async function answerQuestion(question: string): Promise<AskQuestionResponse> {
  const analyzedReviews = await getAllAnalyzedReviews();
  const rawReviews = await getAllRawReviews();

  // Expand query using LLM before retrieval
  const expandedKeywords = await expandQuery(question);
  const combinedQuery = expandedKeywords ? `${question}, ${expandedKeywords}` : question;

  console.log(`[askService] Original Question: "${question}"`);
  console.log(`[askService] Expanded Keywords: "${expandedKeywords}"`);
  console.log(`[askService] Combined Query: "${combinedQuery}"`);

  // Retrieve top 10 relevant reviews using TF-IDF cosine similarity vector match on combined query
  const retrieved = retrieveRelevantReviews(combinedQuery, analyzedReviews, rawReviews, 10);

  if (retrieved.length === 0) {
    return {
      answer: "",
      answer_points: [],
      source_counts: { PlayStore: 0, AppStore: 0 },
      supporting_reviews: [],
    };
  }

  // Build grounded context for the LLM using ONLY the retrieved relevant reviews
  const reviewsContext = retrieved.map((r, index) => {
    return `[Review #${index + 1}]
Source: ${r.raw?.platform || 'Unknown'}
Text: ${r.raw?.review_text || ''}
Pain Point: ${r.analyzed.pain_point || ''}
Summary: ${r.analyzed.summary || ''}`;
  }).join('\n\n');

  // Instruct LLM to hedge its answer if we have fewer than 3 reviews
  let hedgeInstruction = "";
  if (retrieved.length < 3) {
    hedgeInstruction = `
[IMPORTANT - LIMITED DATA WARNING]
Only ${retrieved.length} relevant user review(s) passed the similarity threshold for this query.
Because data is extremely limited, you MUST:
1. Hedge your answer explicitly (e.g., start with "Based on limited user feedback, ..." or "Only a few users have commented on this ...").
2. Do NOT write a confident multi-bullet list or summary. Write a brief, single-paragraph explanation highlighting what the limited feedback mentions, and state that there are not enough reviews to provide a comprehensive analysis.
3. Answer ONLY using the actual text from the ${retrieved.length} review(s) listed below. Do NOT use outside general knowledge or make assumptions outside these specific reviews.`;
  }

  const prompt = `User Question: ${question}

Instructions:
1. Answer the User Question using ONLY the information provided in the Reviews below.
2. Do NOT use general knowledge or make assumptions outside the provided reviews.
3. If the provided reviews do not contain enough information to answer the question, state that you do not have enough relevant user reviews to answer.
4. Keep the answer grounded and verifiable.
${hedgeInstruction}

Reviews:
${reviewsContext}`;

  const jsonString = await callGroqAPI(prompt, askAnswerSystemPrompt);

  let answer = "";
  let answer_points: string[] = [];
  let used_reviews = true;
  
  try {
    let cleaned = jsonString.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '').trim();
    }
    // Clean trailing commas in objects and arrays to prevent common parse failures
    cleaned = cleaned.replace(/,(\s*[\]}])/g, '$1');
    
    const parsed = JSON.parse(cleaned);
    answer = parsed.answer || "";
    answer_points = parsed.answer_points || [];
    used_reviews = parsed.used_reviews ?? true;
  } catch (e: any) {
    console.warn('[askService] Failed to parse LLM response JSON. Error:', e.message);
    console.warn('[askService] Raw LLM Response:', jsonString);
    
    // Attempt parsing using robust regex fallback that supports multi-line answers and escaped characters
    const cleaned = jsonString.trim();
    const answerMatch = cleaned.match(/"answer"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
    if (answerMatch && answerMatch[1]) {
      answer = answerMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\');
    }
    
    const pointsMatch = cleaned.match(/"answer_points"\s*:\s*\[([\s\S]*?)\]/);
    if (pointsMatch && pointsMatch[1]) {
      const matches = pointsMatch[1].match(/"((?:[^"\\]|\\.)*)"/g);
      if (matches) {
        answer_points = matches.map(m => m.slice(1, -1)
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"')
          .replace(/\\t/g, '\t')
          .replace(/\\\\/g, '\\'));
      }
    }
    
    const usedReviewsMatch = cleaned.match(/"used_reviews"\s*:\s*(true|false)/);
    if (usedReviewsMatch) {
      used_reviews = usedReviewsMatch[1] === 'true';
    }

    if (!answer && answer_points.length === 0) {
      answer = cleaned;
    }
  }

  // Remove Reddit source counts entirely
  const source_counts = {
    PlayStore: used_reviews ? rawReviews.filter(r => r.platform.toLowerCase().includes('play store') || r.platform.toLowerCase().includes('android')).length : 0,
    AppStore: used_reviews ? rawReviews.filter(r => r.platform.toLowerCase().includes('app store') || r.platform.toLowerCase().includes('ios')).length : 0,
  };

  const response: AskQuestionResponse = {
    answer,
    answer_points,
    source_counts,
    supporting_reviews: used_reviews ? retrieved.map(r => ({
      ...r.analyzed,
      review_text: r.raw?.review_text || ''
    })) : [],
  };

  // Log the question
  await supabaseAdmin.from('question_logs').insert([{
    question,
    answer,
    source_counts,
    supporting_review_ids: response.supporting_reviews.map(r => r.id)
  }]);

  return response;
}
