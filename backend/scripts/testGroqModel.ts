import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('GROQ_API_KEY not set');
    return;
  }

  const model = 'llama-3.1-8b-instant';
  console.log(`Testing Groq model: ${model}`);

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      messages: [
        { role: 'user', content: 'Say hello in 5 words.' }
      ],
      model,
      stream: false,
      temperature: 0,
    }),
  });

  const text = await response.text();
  console.log('Response status:', response.status);
  console.log('Response body:', text);
}

main().catch(console.error);
