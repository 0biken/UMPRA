// Mixes voiceover + SFX on the scene timeline and muxes with the picture.
// Inputs: video/out/timeline.json (from render.mjs), video/audio/clean/vo-*.wav, video/audio/sfx/*.wav
// Output: video/out/umpra-demo.mp4
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { total, start, lead, cues } = JSON.parse(readFileSync(join(here, 'out', 'timeline.json'), 'utf8'));
const vo = readdirSync(join(here, 'audio', 'clean')).filter(f => f.endsWith('.wav')).sort();

// Per SFX: gain (dB) and offset (s) so the sound's peak lands on the visual cue.
const SFX = {
  whoosh: { g: -16, off: -0.05 }, tick: { g: -14, off: 0 }, pop: { g: -20, off: -0.03 },
  reveal: { g: -12, off: -0.1 }, click: { g: -12, off: 0 }, lock: { g: -12, off: -0.12 },
  cash: { g: -20, off: -0.25 }, draw: { g: -18, off: -0.1 }, scan: { g: -26, off: 0 },
  confirm: { g: -18, off: 0 }, alert: { g: -12, off: 0 }, chime: { g: -20, off: 0 },
};

const inputs = [], chains = [];
vo.forEach((f, i) => {
  inputs.push('-i', join(here, 'audio', 'clean', f));
  const ms = Math.round((start[i] + lead) * 1000);
  chains.push(`[${inputs.length / 2 - 1}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[a${chains.length}]`);
});
for (const { t, kind } of cues) {
  const s = SFX[kind]; if (!s) throw new Error(`no sfx for ${kind}`);
  inputs.push('-i', join(here, 'audio', 'sfx', `${kind}.wav`));
  const ms = Math.max(0, Math.round((t + s.off) * 1000));
  chains.push(`[${inputs.length / 2 - 1}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${s.g}dB,adelay=${ms}|${ms}[a${chains.length}]`);
}
const n = chains.length;
const filter = chains.join(';') + ';' + Array.from({ length: n }, (_, i) => `[a${i}]`).join('') +
  `amix=inputs=${n}:normalize=0:duration=longest,apad=whole_dur=${total},atrim=0:${total},` +
  `loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=out:st=${total - 0.8}:d=0.8[mix]`;

const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', join(here, 'out', 'picture.mp4'), ...inputs.flatMap((x, i) => x === '-i' ? ['-i'] : [x]),
  '-filter_complex', filter.replace(/\[(\d+):a\]/g, (_, k) => `[${+k + 1}:a]`),
  '-map', '0:v', '-map', '[mix]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart',
  '-t', String(total), join(here, 'out', 'umpra-demo.mp4')];
const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`umpra-demo.mp4: ${vo.length} VO clips, ${cues.length} SFX cues, ${total}s`);
