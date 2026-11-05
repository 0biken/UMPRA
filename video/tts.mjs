// Generates one WAV per narration scene with Gemini TTS.
// Usage: node --env-file=.env.local video/tts.mjs [sceneId]
// The API key is read from GEMINI_API_KEY only; never hard-code it.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error('GEMINI_API_KEY missing (run with --env-file=.env.local)');
const model = process.env.TTS_MODEL ?? 'gemini-3.8-flash-tts';
const { voice, style, scenes } = JSON.parse(readFileSync(join(here, 'narration.json'), 'utf8'));
const only = process.argv[2];
mkdirSync(join(here, 'audio'), { recursive: true });

function wav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

for (const [i, s] of scenes.entries()) {
  if (only && s.id !== only) continue;
  const body = {
    contents: [{ parts: [{ text: `${style}: ${s.text}` }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  };
  let r, j;
  for (let attempt = 0; attempt < 6; attempt++) {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body),
    });
    j = await r.json();
    if (r.status !== 429) break;
    console.log(`${s.id}: rate limited, waiting 30s`);
    await new Promise(res => setTimeout(res, 30000));
  }
  if (!r.ok) throw new Error(`${s.id}: ${r.status} ${j.error?.message}`);
  const part = j.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (!part) throw new Error(`${s.id}: no audio returned`);
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType)?.[1] ?? 24000);
  const pcm = Buffer.from(part.inlineData.data, 'base64');
  const file = join(here, 'audio', `vo-${String(i + 1).padStart(2, '0')}-${s.id}.wav`);
  writeFileSync(file, wav(pcm, rate));
  console.log(`${s.id}\t${(pcm.length / 2 / rate).toFixed(2)}s`);
}
