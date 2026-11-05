// Renders video/scene.html frame by frame (deterministic seek) and encodes with ffmpeg.
// Usage: node video/render.mjs            -> video/out/picture.mp4
//        node video/render.mjs --stills 3,20,40  -> video/out/stills/*.png
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FPS = 30;
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
const stillsArg = process.argv.indexOf('--stills');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(pathToFileURL(join(here, 'scene.html')).href + '?render');
await page.evaluate(() => window.ready);
const meta = await page.evaluate(() => ({ total: window.TOTAL, start: window.START, lead: window.VO_LEAD, cues: window.CUES }));
writeFileSync(join(out, 'timeline.json'), JSON.stringify(meta, null, 2));

if (stillsArg > 0) {
  mkdirSync(join(out, 'stills'), { recursive: true });
  for (const t of process.argv[stillsArg + 1].split(',').map(Number)) {
    await page.evaluate(t => window.seek(t), t);
    await page.screenshot({ path: join(out, 'stills', `t${String(t).padStart(6, '0')}.png`) });
  }
  console.log('stills done; total', meta.total);
} else {
  const frames = Math.round(meta.total * FPS);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS), join(out, 'picture.mp4')], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = 0; f < frames; f++) {
    await page.evaluate(t => window.seek(t), f / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 300 === 0) console.log(`frame ${f}/${frames}`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  console.log('picture.mp4 written', meta.total, 's');
}
await browser.close();
