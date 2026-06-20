import express, { Request, Response } from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import cron from 'node-cron';

// Load environment variables from .env.local
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import { answerQuestion } from '../services/askService';
import { generateAnalysisSummary, reanalyzeReviewsFromFile, importClassifiedReviews } from '../services/analysisService';
import { AskQuestionRequest } from '../types/ask';
import { runAllScrapers } from '../scripts/runAllScrapers';
import { scrapeState } from '../services/scrapeState';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

// ─── Scraping state ───────────────────────────────────────────────────────────
let isScraping = false;
let lastScrapedAt: Date | null = null;

async function runScrapingPipeline(source = 'scheduler') {
  if (isScraping) {
    console.log(`[Pipeline] Already running — skipping trigger from ${source}`);
    return;
  }
  isScraping = true;
  scrapeState.isScraping = true;
  scrapeState.stage = 'scraping';
  scrapeState.classifiedCount = 0;
  scrapeState.totalPending = 0;
  scrapeState.error = null;
  scrapeState.lastScrapedAt = lastScrapedAt;

  console.log(`\n[Pipeline] 🚀 Starting integrated pipeline (triggered by: ${source}) at ${new Date().toISOString()}`);

  // Set up a global timeout of 10 minutes to reset the state if it gets stuck
  const timeoutId = setTimeout(() => {
    if (isScraping) {
      console.error('[Pipeline] ❌ Pipeline timed out after 10 minutes!');
      isScraping = false;
      scrapeState.isScraping = false;
      scrapeState.stage = 'idle';
      scrapeState.error = 'Scraping pipeline timed out after 10 minutes.';
    }
  }, 10 * 60 * 1000);

  try {
    // 1. Scrape real-time reviews to scraped_raw_reviews.json
    console.log('[Pipeline] Step 1: Scraping reviews...');
    scrapeState.stage = 'scraping';
    await runAllScrapers();
    
    // 2. Classify raw reviews using LLM to classified_reviews.json
    console.log('[Pipeline] Step 2: Classifying reviews using LLM...');
    scrapeState.stage = 'classifying';
    await reanalyzeReviewsFromFile();

    // 3. Import classified reviews to Database to update dashboard
    console.log('[Pipeline] Step 3: Importing classifications to Database...');
    scrapeState.stage = 'importing';
    await importClassifiedReviews();

    lastScrapedAt = new Date();
    scrapeState.lastScrapedAt = lastScrapedAt;
    scrapeState.stage = 'idle';
    console.log(`[Pipeline] ✅ End-to-end pipeline finished successfully at ${lastScrapedAt.toISOString()}`);
  } catch (err: any) {
    console.error(`[Pipeline] ✗ Pipeline Error: ${err.message}`);
    scrapeState.error = err.message || 'Scraping pipeline failed.';
    scrapeState.stage = 'idle';
  } finally {
    isScraping = false;
    scrapeState.isScraping = false;
    clearTimeout(timeoutId);
  }
}

// ─── Schedule: every 24 hours at midnight ────────────────────────────────────
// Cron format: second(opt) minute hour day month weekday
cron.schedule('0 0 * * *', () => {
  runScrapingPipeline('cron (daily)');
}, { timezone: 'UTC' });

console.log('[Scraper] ⏰ Scheduled: daily at midnight UTC');

// Run once immediately on boot so data is fresh right away
// runScrapingPipeline('server boot');

// ─── API Routes ───────────────────────────────────────────────────────────────

app.post('/api/ask', async (req: Request, res: Response) => {
  try {
    const body: AskQuestionRequest = req.body;
    if (!body.question) {
      res.status(400).json({ success: false, error: 'Question is required' });
      return;
    }
    const response = await answerQuestion(body.question);
    res.json({ success: true, data: response });
  } catch (error) {
    console.error('Error answering question:', error);
    res.status(500).json({ success: false, error: 'Failed to answer question' });
  }
});

app.get('/api/analysis-summary', async (req: Request, res: Response) => {
  try {
    const summary = await generateAnalysisSummary();
    res.json({ success: true, summary });
  } catch (error) {
    console.error('Error fetching analysis summary:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch summary' });
  }
});

// Manual on-demand trigger (e.g. from Dashboard "Refresh" button)
app.post('/api/scrape', async (req: Request, res: Response) => {
  if (isScraping) {
    res.json({ success: false, message: 'Scrape already in progress', lastScrapedAt });
    return;
  }
  scrapeState.error = null; // reset error
  // Fire and forget — don't block the HTTP response
  runScrapingPipeline('manual API trigger').catch(console.error);
  res.json({ success: true, message: 'Scraping started in background', lastScrapedAt });
});

// Scrape status endpoint
app.get('/api/scrape/status', (_req: Request, res: Response) => {
  res.json({
    isScraping: scrapeState.isScraping,
    lastScrapedAt: scrapeState.lastScrapedAt,
    stage: scrapeState.stage,
    totalPending: scrapeState.totalPending,
    classifiedCount: scrapeState.classifiedCount,
    error: scrapeState.error,
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Backend server running on http://localhost:${PORT}`);
});
