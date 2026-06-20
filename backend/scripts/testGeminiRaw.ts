import * as dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
];

async function testModel(key: string, model: string): Promise<boolean> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Reply with JSON: {"ok": true}' }] }],
        generationConfig: { temperature: 0, response_mime_type: 'application/json' },
      }),
    });
    const text = await response.text();
    if (response.ok) {
      console.log(`  ✅ ${model} → ${response.status} → ${text.substring(0, 80)}`);
      return true;
    } else {
      const snippet = text.replace(/\n/g, ' ').substring(0, 120);
      console.log(`  ❌ ${model} → ${response.status} → ${snippet}`);
      return false;
    }
  } catch (e: any) {
    console.log(`  💥 ${model} → EXCEPTION: ${e.message}`);
    return false;
  }
}

async function run() {
  const keys = [
    { name: 'GEMINI_API_KEY', val: process.env.GEMINI_API_KEY },
    { name: 'GEMINI_API_KEY_2', val: process.env.GEMINI_API_KEY_2 }
  ];

  for (const k of keys) {
    if (!k.val) {
      console.log(`\n⚠️ ${k.name} not set.\n`);
      continue;
    }
    console.log(`\nTesting ${MODELS.length} models with key ${k.name} (${k.val.substring(0, 8)}...):\n`);
    for (const model of MODELS) {
      const ok = await testModel(k.val, model);
      if (ok) {
        console.log(`  🎉 ${k.name} works for ${model}`);
      }
    }
  }
}

run().catch(console.error);
