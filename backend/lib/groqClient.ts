export let isRateLimited = false;

import { OTHER_UNSPECIFIED, PoorQualitySubReason } from '../prompts/refinePoorQualityPrompt';
import { callGeminiAPI, isGeminiRateLimited } from './geminiClient';

export function isGroqRateLimited(): boolean {
  return isRateLimited;
}

/** True only when BOTH Groq and Gemini are exhausted */
export function isAnyLLMAvailable(): boolean {
  return !isRateLimited || !isGeminiRateLimited();
}

export async function callGroqAPI(prompt: string, systemPrompt: string, retries = 3): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;

  // If Groq is rate-limited, route directly to Gemini (no mock)
  if (isRateLimited) {
    return callWithGemini(prompt, systemPrompt);
  }

  if (!apiKey) {
    console.warn('GROQ_API_KEY is not set. Falling back to Gemini...');
    return callWithGemini(prompt, systemPrompt);
  }

  try {
    // Only force json_object mode for the review analysis prompt, not the ask/answer prompt
    const isJsonMode = systemPrompt.includes('pain_point') || systemPrompt.includes('extract structured insights') || systemPrompt.includes('analyze the review') || systemPrompt.includes('second-pass classification');
    
    const requestBody: any = {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      model: 'llama-3.3-70b-versatile',
      stream: false,
      temperature: 0,
    };

    if (isJsonMode) {
      requestBody.response_format = { type: 'json_object' };
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      if (response.status === 429) {
        const errorText = await response.text();
        if (errorText.includes("rate_limit_exceeded") || errorText.includes("Limit 100000") || errorText.includes("Limit exceeded")) {
          console.warn(`Groq daily token rate limit exceeded. Falling back to Gemini API...`);
          isRateLimited = true;
          return callWithGemini(prompt, systemPrompt);
        }
        
        if (retries > 0) {
          const retryAfterSec = 3;
          console.warn(`Groq API rate limit hit (429). Retrying in ${retryAfterSec} seconds... (Attempts remaining: ${retries})`);
          await new Promise(resolve => setTimeout(resolve, retryAfterSec * 1000));
          return callGroqAPI(prompt, systemPrompt, retries - 1);
        } else {
          isRateLimited = true;
        }
        return callWithGemini(prompt, systemPrompt);
      }

      const errorText2 = await response.text();
      console.warn(`Groq API returned error (${response.status}): ${errorText2}. Falling back to Gemini...`);
      return callWithGemini(prompt, systemPrompt);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error: any) {
    console.warn(`Groq API connection failed: ${error.message || error}. Falling back to Gemini...`);
    return callWithGemini(prompt, systemPrompt);
  }
}

/** Try Gemini; if it also fails, fall back to local mock as last resort */
async function callWithGemini(prompt: string, systemPrompt: string): Promise<string> {
  if (!isGeminiRateLimited() && process.env.GEMINI_API_KEY) {
    try {
      return await callGeminiAPI(prompt, systemPrompt);
    } catch (err: any) {
      if (!err.message?.includes('daily quota exhausted')) {
        console.warn(`Gemini failed: ${err.message}. Falling back to local mock...`);
      } else {
        console.warn('Gemini daily quota also exhausted. Falling back to local mock...');
      }
    }
  } else if (!process.env.GEMINI_API_KEY) {
    console.warn('GEMINI_API_KEY not set. Falling back to local mock...');
  }
  return getMockResponse(prompt, systemPrompt);
}



function getMockResponse(prompt: string, systemPrompt: string): string {
  if (systemPrompt.includes('category selector')) {
    return mockSelectCategories(prompt);
  }
  if (systemPrompt.includes('second-pass classification')) {
    return mockRefinePoorQuality(prompt);
  }
  if (systemPrompt.includes('query expansion assistant')) {
    return mockExpandQuery(prompt);
  }

  // Route based on which system prompt is being used:
  // - Review analysis prompt contains 'pain_point' and 'analyze the review'
  // - Ask/answer prompt contains 'used_reviews'
  if (
    systemPrompt.includes('pain_point') ||
    systemPrompt.includes('analyze the review') ||
    systemPrompt.includes('extract structured insights')
  ) {
    return mockAnalyzeReview(prompt);
  } else {
    return mockAnswerQuestion(prompt);
  }
}


function extractAvailableCategories(prompt: string): string[] {
  const section = prompt.split('Available pain point categories with counts:')[1]?.split('Available themes with counts:')[0] || '';
  return section
    .split('\n')
    .map(line => line.replace(/^-\s*/, '').replace(/\s*\(\d+\)\s*$/, '').trim())
    .filter(Boolean);
}

function mockSelectCategories(prompt: string): string {
  const question = prompt.match(/User question: \"([^\"]*)\"/)?.[1] || prompt;
  const lower = question.toLowerCase();
  const categories = extractAvailableCategories(prompt);
  const findCategory = (needle: string) => categories.find(c => c.toLowerCase() === needle.toLowerCase());

  if (lower.includes('ipl') || lower.includes('cricket') || lower.includes('wrapped')) {
    return JSON.stringify({
      intent: 'off_topic',
      selected_pain_points: [],
      selected_themes: [],
      rationale: 'The question is not about Spotify music discovery or recommendation review pain points.'
    });
  }

  if (lower.includes('what is frustrating') || lower.includes('frustrating users') || lower.includes('pain points') || lower.includes('user frustrations') || lower.includes('unmet need') || lower.includes('unmet needs') || lower.includes('user needs') || lower.includes('across reviews') || lower.includes('consistently across reviews')) {
    return JSON.stringify({
      intent: 'broad',
      selected_pain_points: categories,
      selected_themes: [],
      rationale: 'The question broadly asks about Spotify music discovery, recommendation frustrations, or unmet user needs across reviews.'
    });
  }

  if (lower.includes('smart shuffle') || lower.includes('shuffle')) {
    const category = findCategory('Smart Shuffle forces the same popular songs');
    return JSON.stringify({
      intent: 'narrow',
      selected_pain_points: category ? [category] : [],
      selected_themes: ['Smart Shuffle'],
      rationale: 'The question specifically asks about Spotify Smart Shuffle recommendation problems.'
    });
  }

  if (lower.includes('discover weekly')) {
    const category = findCategory('Discover Weekly repeats songs I already know');
    return JSON.stringify({
      intent: 'narrow',
      selected_pain_points: category ? [category] : [],
      selected_themes: ['Discover Weekly'],
      rationale: 'The question specifically asks about Spotify Discover Weekly recommendation problems.'
    });
  }

  if (lower.includes('podcast')) {
    const category = findCategory('Podcasts clutter the music discovery feed');
    return JSON.stringify({
      intent: 'narrow',
      selected_pain_points: category ? [category] : [],
      selected_themes: ['Podcasts'],
      rationale: 'The question specifically asks about Spotify podcasts in discovery surfaces.'
    });
  }

  return JSON.stringify({
    intent: 'off_topic',
    selected_pain_points: [],
    selected_themes: [],
    rationale: 'The question is not clearly about Spotify music discovery or recommendation review pain points.'
  });
}

function mockExpandQuery(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (lower.includes('shuffle') || lower.includes('repetitive') || lower.includes('repeat')) {
    return "smart shuffle, repeating, repeat, loop, variety, song loop, same songs, shuffle broken";
  }
  if (lower.includes('podcast')) {
    return "podcast, podcasts, clutter, home feed, show, hide, recommendations, episode";
  }
  if (lower.includes('discover') || lower.includes('recommend') || lower.includes('weekly') || lower.includes('playlist') || lower.includes('song') || lower.includes('music')) {
    return "music discovery, recommend, suggestions, discover weekly, release radar, algorithm, new artist, explore";
  }
  if (lower.includes('ipl') || lower.includes('cricket') || lower.includes('india')) {
    return "Indian Premier League, cricket, T20, sports, tournament";
  }
  return "";
}


function mockAnalyzeReview(prompt: string): string {
  // Extract the raw review text from the user prompt
  const reviewTextParts = prompt.split('Review Text:\n');
  const reviewText = reviewTextParts[1] ? reviewTextParts[1].trim() : prompt;
  const lower = reviewText.toLowerCase();

  let theme = "Quality";
  let pain_point = "Poor recommendation quality overall";
  let user_need = "More accurate and high-quality recommendation algorithms.";
  let sentiment = "negative";
  let discovery_behavior = "Relying on automated Spotify playlists.";
  let summary = "The user is frustrated with Spotify's recommendations.";

  // Unrelated topics check: If review is purely about app crashes, payment issues, or UI bugs without any music discovery context
  const isUnrelated = (
    lower.includes("crash") || 
    lower.includes("freeze") || 
    lower.includes("login") || 
    lower.includes("password") || 
    lower.includes("account") || 
    lower.includes("payment") || 
    lower.includes("subscription") || 
    lower.includes("billing") || 
    lower.includes("price") || 
    lower.includes("money") || 
    lower.includes("refund") || 
    lower.includes("ad ") || 
    lower.includes("ads") || 
    lower.includes("ui") || 
    lower.includes("bug") ||
    lower.includes("update") || 
    lower.includes("slow") || 
    lower.includes("lag")
  ) && !(
    lower.includes("recommend") || 
    lower.includes("suggest") || 
    lower.includes("discover") || 
    lower.includes("playlist") || 
    lower.includes("song") || 
    lower.includes("track") || 
    lower.includes("music") || 
    lower.includes("artist")
  );

  if (isUnrelated) {
    return JSON.stringify({
      pain_point: "not_relevant",
      discovery_behavior: "not_relevant",
      user_need: "not_relevant",
      sentiment: "negative",
      theme: "Unrelated",
      summary: "Review is about app performance, bugs, or payment issues rather than music discovery.",
      confidence: "high"
    });
  }

  // Specific pain points with fuzzy matching rules
  if (lower.includes("weekly") || lower.includes("discover weekly") || lower.includes("same songs every day") || lower.includes("same tracks every week") || lower.includes("repeats songs i already know")) {
    theme = "Discover Weekly";
    pain_point = "Discover Weekly repeats songs I already know";
    user_need = "Truly fresh and obscure music recommendations in weekly discovery.";
    summary = "Frustrated that Discover Weekly plays the same artists repeatedly.";
  } else if (lower.includes("shuffle") || lower.includes("smart shuffle") || lower.includes("dumb shuffle")) {
    theme = "Smart Shuffle";
    pain_point = "Smart Shuffle forces the same popular songs";
    user_need = "A more random or customized shuffle feature.";
    summary = "Critique of Smart Shuffle for playing the same popular songs.";
  } else if (lower.includes("daily mix") || lower.includes("mixes") || lower.includes("daily mixes") || lower.includes("too much overlap")) {
    theme = "Daily Mixes";
    pain_point = "Daily Mixes have too much overlap or repeat tracks";
    user_need = "Unique Daily Mixes with less overlap and higher track variety.";
    summary = "Dislikes the repetition and lack of variety in generated Daily Mixes.";
  } else if (lower.includes("control") || lower.includes("slider") || lower.includes("obscure") || lower.includes("adventurous") || lower.includes("fine-tune")) {
    theme = "Control";
    pain_point = "Lack of control over how adventurous recommendations are";
    user_need = "Fine-grained controls (like obscurity sliders) to tweak the recommendation engine.";
    summary = "Desires active settings to control music exploration parameters.";
  } else if (lower.includes("radar") || lower.includes("release radar") || lower.includes("misses indie") || lower.includes("misses artist")) {
    theme = "Release Radar";
    pain_point = "Release Radar misses indie artists I follow";
    user_need = "Accurate and comprehensive tracking of new music from followed indie artists.";
    summary = "Dissatisfaction with Release Radar missing releases from followed artists.";
  } else if (lower.includes("radio") || lower.includes("recycle liked")) {
    theme = "Radio";
    pain_point = "Radio stations recycle liked songs instead of finding new artists";
    user_need = "Radios that branch out and discover similar but unfamiliar artists.";
    summary = "Radio feature fails to discover new tracks, recycling liked songs.";
  } else if (lower.includes("podcast") || lower.includes("clutter")) {
    theme = "Podcasts";
    pain_point = "Podcasts clutter the music discovery feed";
    user_need = "Option to hide or separate podcast recommendations.";
    summary = "Annoyed by podcast clutter on the home feed and discovery pages.";
  } else if (lower.includes("artist") || lower.includes("indie") || lower.includes("mainstream") || lower.includes("push label")) {
    theme = "Artist Discovery Bias";
    pain_point = "Algorithm pushes mainstream tracks over organic discoveries";
    user_need = "Better visibility and recommendations of lesser-known indie artists.";
    summary = "Feels Spotify favors mainstream labels over organic indie discovery.";
  } else if (lower.includes("autoplay") || lower.includes("loops listening")) {
    theme = "Autoplay";
    pain_point = "Autoplay loops the same recent listening history";
    user_need = "More diverse autoplay that explores outside recent history.";
    summary = "Frustrated that autoplay plays the same tracks over and over.";
  } else if (lower.includes("block") || lower.includes("dislike") || lower.includes("ban ") || lower.includes("permanently")) {
    theme = "Blocking";
    pain_point = "No way to permanently block or dislike a song";
    user_need = "A 'dislike' or 'block' button to train the algorithm.";
    summary = "Wants a feature to explicitly block songs or artists.";
  } else if (lower.includes("bleed") || lower.includes("liked") || lower.includes("already liked")) {
    theme = "Algorithm Overfit";
    pain_point = "Liked songs bleed too heavily into new recommendations";
    user_need = "Separation between liked songs and new discovery streams.";
    summary = "Algorithm relies too heavily on already liked tracks.";
  } else if (lower.includes("ruin") || lower.includes("taste profile") || lower.includes("temporary") || lower.includes("kid listening")) {
    theme = "Taste Profile";
    pain_point = "Temporary listening habits ruin taste profile";
    user_need = "Incognito listening mode or ability to reset taste profile.";
    summary = "One-off listening sessions negatively impact future recommendations.";
  } else if (lower.includes("daylist") || lower.includes("niche") || lower.includes("categor")) {
    theme = "Categorization";
    pain_point = "Daylist or niche mixes are poorly categorized";
    user_need = "Accurate genre and mood categorization in auto-generated mixes.";
    summary = "Complains that niche mixes group unrelated songs together.";
  } else if (lower.includes("echo chamber") || lower.includes("trapped") || lower.includes("bubble")) {
    theme = "Echo Chamber";
    pain_point = "Trapped in a genre echo chamber";
    user_need = "Algorithm that bridges genres and breaks out of bubbles.";
    summary = "Feels stuck getting recommendations only in a narrow genre.";
  } else if (lower.includes("vibe") || lower.includes("context") || lower.includes("playlist mood")) {
    theme = "Context";
    pain_point = "Recommendations ignore my actual playlist vibe";
    user_need = "Context-aware recommendations that fit the playlist's mood.";
    summary = "Playlist additions don't match the intended vibe.";
  }
  // Broader fallbacks
  else if (lower.includes("repeat") || lower.includes("same song") || lower.includes("same artist") || lower.includes("same play") || lower.includes("loop") || lower.includes("cycle") || lower.includes("redundant") || lower.includes("constantly playing") || lower.includes("always the same")) {
    theme = "Repetitive Recommendations";
    pain_point = "General repetitiveness in recommendations";
    user_need = "Greater variety and freshness in music suggestions.";
    summary = "Complains about recommendations being highly repetitive and loops of the same songs.";
  } else if (lower.includes("feature") || lower.includes("want") || lower.includes("need") || lower.includes("wish") || lower.includes("request") || lower.includes("add") || lower.includes("could you") || lower.includes("please make") || lower.includes("option") || lower.includes("missing")) {
    theme = "Missing Features";
    pain_point = "Missing music discovery features";
    user_need = "New tools and options to search and filter discoveries.";
    summary = "Requests new discovery features, settings, or search filtering capabilities.";
  } else {
    // Catch-all fallback
    theme = "Recommendation Quality";
    pain_point = "Poor recommendation quality overall";
    user_need = "More accurate and high-quality recommendation algorithms.";
    summary = "General dissatisfaction with the quality of Spotify's music recommendations.";
  }

  if (lower.includes("love") || lower.includes("great") || lower.includes("good") || lower.includes("fine")) {
    sentiment = "neutral";
  }

  return JSON.stringify({
    pain_point,
    discovery_behavior,
    user_need,
    sentiment,
    theme,
    summary,
    confidence: "medium"
  });
}

function mockRefinePoorQuality(prompt: string): string {
  const reviewTextParts = prompt.split('Review Text:\n');
  const reviewText = reviewTextParts[1] ? reviewTextParts[1].trim() : prompt;
  const lower = reviewText.toLowerCase();

  // Strip Play Store title/rating wrapper for matching
  const bodyOnly = lower.includes('\n\n')
    ? lower.split('\n\n').slice(1).join('\n\n')
    : lower;

  const text = bodyOnly.length > 20 ? bodyOnly : lower;

  let pain_point: PoorQualitySubReason = "Recommendations don't match my actual taste";

  if (
    lower.includes('used to be better') ||
    lower.includes('got worse') ||
    lower.includes('getting worse') ||
    lower.includes('declined') ||
    lower.includes('not as good as before') ||
    lower.includes('used to love') ||
    lower.includes('used to be good') ||
    lower.includes('not what it used to')
  ) {
    pain_point = 'Recommendations got worse over time';
  } else if (
    text.includes('repeat') ||
    text.includes('same song') ||
    text.includes('same artist') ||
    text.includes('same play') ||
    text.includes('over and over') ||
    text.includes('again and again') ||
    text.includes('boring') ||
    text.includes('stale') ||
    text.includes('no variety')
  ) {
    pain_point = 'Recommendations are too repetitive';
  } else if (
    text.includes('new artist') ||
    text.includes('discover artist') ||
    text.includes('find new') ||
    text.includes('unfamiliar') ||
    (text.includes('obscure') && !text.includes('mainstream')) ||
    (text.includes('indie') && text.includes('discover'))
  ) {
    pain_point = 'Not enough new artist discovery';
  } else if (
    text.includes('mainstream') ||
    text.includes('top 40') ||
    text.includes('too popular') ||
    text.includes('radio hit') ||
    (text.includes('popular') && text.includes('only')) ||
    (text.includes('generic') && !text.includes('random'))
  ) {
    pain_point = 'Recommendations are too mainstream/generic';
  } else if (
    text.includes('random') ||
    text.includes('low effort') ||
    text.includes('low-effort') ||
    text.includes('lazy') ||
    text.includes('makes no sense') ||
    text.includes('nonsense') ||
    text.includes('who chose')
  ) {
    pain_point = 'Recommendations feel random or low-effort';
  } else if (
    text.includes("don't know me") ||
    text.includes('doesnt know me') ||
    text.includes("doesn't know my taste") ||
    text.includes('not my taste') ||
    text.includes('wrong genre') ||
    text.includes('wrong for me') ||
    text.includes('does not match') ||
    text.includes("doesn't match") ||
    text.includes('suggests stuff i hate') ||
    text.includes('not for me') ||
    text.includes('bad recommend') ||
    text.includes('poor recommend') ||
    text.includes('awful recommend') ||
    text.includes('terrible recommend') ||
    text.includes('suggestions are bad') ||
    text.includes('algorithm') ||
    text.includes('recommendation')
  ) {
    pain_point = "Recommendations don't match my actual taste";
  } else if (
    text.trim().length < 25 &&
    (text.includes('bad') || text.includes('suck') || text.includes('terrible')) &&
    !text.includes('because') &&
    !text.includes('same') &&
    !text.includes('genre')
  ) {
    pain_point = OTHER_UNSPECIFIED;
  }

  return JSON.stringify({
    pain_point,
    confidence: 'medium',
  });
}

function mockAnswerQuestion(prompt: string): string {
  // Isolate the user question
  let question = prompt;
  if (prompt.includes('\n\nReviews:')) {
    question = prompt.split('\n\nReviews:')[0];
  }
  question = question.replace('User Question:', '').trim();
  const lower = question.toLowerCase();

  // Detect casual conversation — no reviews needed
  const casualPhrases = ['hi', 'hello', 'hey', 'ok', 'okay', 'thanks', 'thank you', 'cool', 'great', 'sure', 'yes', 'no', 'bye'];
  const isCasual = casualPhrases.some(p => lower.trim() === p || lower.trim().startsWith(p + ' ') || lower.trim().endsWith(' ' + p));

  if (isCasual) {
    return JSON.stringify({
      answer: "Hey! Feel free to ask me anything about Spotify's music discovery features or what users are saying about recommendations.",
      answer_points: [],
      used_reviews: false
    });
  }

  if (prompt.includes('LIMITED DATA WARNING') || prompt.includes('Only 1 relevant') || prompt.includes('Only 2 relevant')) {
    let mentionedDetails = "";
    if (prompt.includes('Text:')) {
      const parts = prompt.split('Text:');
      if (parts[1]) {
        const snippet = parts[1].split('\n')[0].trim().replace(/^["']|["']$/g, '').slice(0, 60);
        mentionedDetails = ` (such as: "${snippet}...")`;
      }
    }
    return JSON.stringify({
      answer: `Based on limited user feedback, only a few users have commented on this. Feedback mentions some aspects${mentionedDetails}, but there are not enough reviews to provide a comprehensive analysis.`,
      answer_points: [],
      used_reviews: true
    });
  }

  let answer = "";
  let answer_points: string[] = [];

  if (lower.includes('what is frustrating') || lower.includes('frustrating users') || lower.includes('user frustrations') || lower.includes('pain points') || lower.includes('unmet need') || lower.includes('unmet needs') || lower.includes('user needs') || lower.includes('across reviews')) {
    answer = "Based on analyzed Spotify reviews, users are mainly frustrated by recommendation quality, missing discovery controls, repetitive surfaces, and clutter in discovery experiences:";
    answer_points = [
      "**Taste Mismatch**: Many reviews say recommendations do not reflect what users actually want to hear.",
      "**Missing Controls**: Users want more ways to steer, filter, or reset discovery experiences.",
      "**Repetition**: Smart Shuffle, mixes, radio, and discovery playlists can feel stale or repetitive.",
      "**Discovery Clutter**: Podcasts and mainstream suggestions can crowd out organic music discovery."
    ];
  } else if (lower.includes('weekly') || lower.includes('discover weekly')) {
    answer = "Based on the analyzed user reviews, Spotify's Discover Weekly is facing several criticisms:";
    answer_points = [
      "**Stale Recommendations**: The algorithm replays the same 20–30 familiar artists rather than introducing new ones.",
      "**Echo Chamber Effect**: Once you listen to a genre (e.g. lo-fi study music), the algorithm over-indexes on it for weeks.",
      "**Loss of \"Magic\"**: Many users report it used to feel exciting but now feels predictable and label-driven.",
      "**Genre Lock-in**: Listening to one niche song permanently skews future recommendations."
    ];
  } else if (lower.includes('shuffle') || lower.includes('smart shuffle')) {
    answer = "Based on user reviews, Spotify's Smart Shuffle is heavily criticized:";
    answer_points = [
      "**Not Truly Random**: Users call it \"dumb shuffle\" — it inserts the same 5–10 popular songs every session.",
      "**Mainstream Bias**: It favors label-pushed popular tracks over niche or user-preferred songs.",
      "**Autoplay Repetition**: When an album ends, autoplay consistently loops the same tracks."
    ];
  } else if (lower.includes('control') || lower.includes('setting') || lower.includes('slider') || lower.includes('algorithm')) {
    answer = "According to reviews, the lack of discovery controls is a primary pain point:";
    answer_points = [
      "**No Tuning Options**: Users want sliders for \"popular vs. obscure\" or \"fine-tune\" to shape their feed.",
      "**No Temporary Modes**: Users want to listen to study music without permanently tainting their taste profile.",
      "**No Reset Button**: Many request a \"start fresh\" option to force the algorithm to re-learn their preferences."
    ];
  } else if (lower.includes('repetit') || lower.includes('same song') || lower.includes('repeat')) {
    answer = "Based on user reviews, song repetition is the most commonly cited frustration:";
    answer_points = [
      "**Daily Mix Overlap**: Multiple Daily Mixes contain the same tracks, defeating the purpose of variety.",
      "**Algorithm Loop**: The recommendation engine appears to get \"stuck\", surfacing the same 50–100 songs indefinitely.",
      "**Playlist Fatigue**: Even user-created playlists feel stale when Autoplay kicks in with familiar tracks."
    ];
  } else {
    answer = "Based on analyzed Spotify reviews, here are the key findings on music discovery:";
    answer_points = [
      "**Algorithmic Echo Chambers**: The algorithm keeps recommending artists users already know, blocking genuine exploration.",
      "**Repetitive Playlists**: Discover Weekly and Daily Mixes look nearly identical week-to-week.",
      "**Mainstream Bias**: Users suspect label deals result in popular tracks getting priority over indie artists.",
      "**No User Controls**: Users want fine-grained parameters to adjust how adventurous or conservative recommendations are."
    ];
  }

  return JSON.stringify({ answer, answer_points, used_reviews: true });
}
