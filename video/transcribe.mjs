// Dev helper: transcribes a WAV with Gemini to check what the TTS actually said.
// Usage: node --env-file=.env.local video/transcribe.mjs <file.wav>
import { readFileSync } from 'node:fs';
const key = process.env.GEMINI_API_KEY;
const model = process.env.T_MODEL ?? 'gemini-flash-lite-latest';
const data = readFileSync(process.argv[2]).toString('base64');
const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
  body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType: 'audio/wav', data } }, { text: 'Transcribe verbatim. Prefix each sentence with its start time in seconds like [12.3].' }] }] }),
});
const j = await r.json();
console.log(r.ok ? j.candidates[0].content.parts.map(p => p.text).join('') : j.error?.message);
