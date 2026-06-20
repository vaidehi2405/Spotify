/**
 * Gemini API client — used as a fallback when Groq hits its daily rate limit.
 * Model: gemini-2.5-flash
 * API: https://generativelanguage.googleapis.com/v1beta/models/...
 */

const exhaustedKeys = new Set<string>();
let activeKeyIndex = 0;
let geminiRateLimited = false;

export function isGeminiRateLimited(): boolean {
  const keys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2
  ].filter(Boolean) as string[];

  const workingKeys = keys.filter(k => !exhaustedKeys.has(k));
  return workingKeys.length === 0 || geminiRateLimited;
}

export async function callGeminiAPI(
  prompt: string,
  systemPrompt: string,
  retries = 3
): Promise<string> {
  const keys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2
  ].filter(Boolean) as string[];

  if (keys.length === 0) {
    throw new Error('Neither GEMINI_API_KEY nor GEMINI_API_KEY_2 is set in .env.local');
  }

  const workingKeys = keys.filter(k => !exhaustedKeys.has(k));

  if (workingKeys.length === 0) {
    geminiRateLimited = true;
    throw new Error('Gemini daily quota exhausted');
  }

  const keyIndex = activeKeyIndex % workingKeys.length;
  const apiKey = workingKeys[keyIndex];
  
  // Advance index for the next call
  activeKeyIndex = (activeKeyIndex + 1) % workingKeys.length;

  const isJsonMode =
    systemPrompt.includes('pain_point') ||
    systemPrompt.includes('second-pass classification');

  // Gemini uses a slightly different schema for JSON enforcement
  const generationConfig: any = {
    temperature: 0,
    ...(isJsonMode ? { response_mime_type: 'application/json' } : {}),
  };

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig,
  };

  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();

      if (response.status === 429) {
        // Permanent daily quota exhaustion: errorText contains "limit: 0" or the free_tier_requests metric.
        // Per-minute / per-day soft limits will NOT have "limit: 0" — those are transient and retryable.
        const isPermanentExhaustion =
          errorText.includes('limit: 0') ||
          errorText.includes('free_tier_requests');

        if (isPermanentExhaustion) {
          console.warn(`Gemini API key ${apiKey.substring(0, 8)}... permanently exhausted (limit: 0).`);
          exhaustedKeys.add(apiKey);
          
          const remainingKeys = keys.filter(k => !exhaustedKeys.has(k));
          if (remainingKeys.length === 0) {
            geminiRateLimited = true;
            throw new Error('Gemini daily quota exhausted');
          }
          console.info(`Switching keys. ${remainingKeys.length} working keys remaining.`);
          return callGeminiAPI(prompt, systemPrompt, retries);
        }

        // Transient per-minute rate limit — back off and retry
        if (retries > 0) {
          const backoffSec = Math.pow(2, 4 - retries) * 5; // 5s, 10s, 20s
          console.warn(`Gemini per-minute rate limit hit. Backing off ${backoffSec}s... (${retries} retries left)`);
          await new Promise(r => setTimeout(r, backoffSec * 1000));
          return callGeminiAPI(prompt, systemPrompt, retries - 1);
        }

        // Exhausted all retries on transient limit — still don't permanently flag
        throw new Error(`Gemini transient rate limit, all retries exhausted: ${errorText.substring(0, 200)}`);
      }

      throw new Error(`Gemini API error (${response.status}): ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    if (!text) {
      throw new Error('Gemini returned empty content');
    }

    return text.trim();
  } catch (err: any) {
    if (err.message?.includes('Gemini daily quota exhausted')) throw err;
    if (retries > 0) {
      console.warn(`Gemini request failed: ${err.message}. Retrying... (${retries} left)`);
      await new Promise(r => setTimeout(r, 2000));
      return callGeminiAPI(prompt, systemPrompt, retries - 1);
    }
    throw err;
  }
}
