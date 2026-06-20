-- Supabase Database Schema for Spotify Review Intelligence Engine

-- 1. raw_reviews
CREATE TABLE IF NOT EXISTS public.raw_reviews (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  source text NOT NULL,
  platform text NOT NULL,
  review_text text NOT NULL,
  rating integer,
  review_url text,
  posted_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

-- 2. analyzed_reviews
CREATE TABLE IF NOT EXISTS public.analyzed_reviews (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  raw_review_id uuid REFERENCES public.raw_reviews(id) ON DELETE CASCADE,
  pain_point text,
  discovery_behavior text,
  user_need text,
  sentiment text,
  theme text,
  summary text,
  confidence text,
  created_at timestamp with time zone DEFAULT now()
);

-- 3. question_logs
CREATE TABLE IF NOT EXISTS public.question_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  question text NOT NULL,
  answer text NOT NULL,
  source_counts jsonb,
  supporting_review_ids jsonb,
  created_at timestamp with time zone DEFAULT now()
);
