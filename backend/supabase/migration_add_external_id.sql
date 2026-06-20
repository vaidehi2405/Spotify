-- Migration: Add external_id and source_url to raw_reviews
-- Run this in your Supabase SQL Editor before running the scraper

-- Add external_id for deduplication across scraping runs
ALTER TABLE public.raw_reviews
  ADD COLUMN IF NOT EXISTS external_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS scraped_at timestamp with time zone;

-- Index for fast duplicate checks
CREATE UNIQUE INDEX IF NOT EXISTS raw_reviews_external_id_idx
  ON public.raw_reviews(external_id)
  WHERE external_id IS NOT NULL;
