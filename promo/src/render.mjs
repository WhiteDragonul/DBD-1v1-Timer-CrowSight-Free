import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'fs'; import path from 'path'; import { spawn } from 'child_process';
const dir = path.dirname(new URL(import.meta.url).pathname);
const mock = fs.readFileSync(dir + '/tauri-mock.js', 'utf8');
const [mode, a1, a2] = process.argv.slice(2); // "stills t1,t2,.." | "video out.mp4 [maxSeconds]"
const FPS = 30;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: process.env.VERT ? { width: 720, height: 1280 } : { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
await ctx.addInitScript(mock);
await ctx.route('**/__promo/**', r => { const f = dir + '/web/' + new URL(r.request().url()).pathname.replace('/__promo/', ''); r.fulfill({ path: f }); });
const page = await ctx.newPage(); const errs = [];
page.on('pageerror', e => errs.push(e.message.slice(0, 200)));
await page.clock.install();
await page.goto('http://localhost:5199/__promo/index.html' + (process.env.VERT ? '?v' : ''), { waitUntil: 'load' });
await page.waitForTimeout(2500);
console.log('prep', await page.evaluate(() => window.prep()));
const TOTAL = await page.evaluate(() => window.TOTAL);
await page.clock.pauseAt(Date.now() + 1500);
const step = async (t) => { await page.clock.runFor(1000 / FPS); await page.evaluate(t => window.seek(t), t); await page.waitForTimeout(12); await page.evaluate(() => window.fit()); };
const frames = Math.round((mode === 'video' && a2 ? +a2 : TOTAL) * FPS);
if (mode === 'stills') {
  const want = a1.split(',').map(Number).map(t => Math.round(t * FPS)); const last = Math.max(...want);
  for (let i = 0; i <= last; i++) { await step(i / FPS); if (want.includes(i)) { await page.screenshot({ path: `${dir}/out/still${process.env.VERT ? 'V' : ''}_${(i / FPS).toFixed(2)}.png` });
    const info = await page.evaluate(() => ({ o1: document.querySelector('#o1').contentDocument.body.innerText.replace(/\s+/g, ' '), o1s: document.querySelector('#o1').contentWindow.__size, o2: document.querySelector('#o2').contentDocument.body.innerText.replace(/\s+/g, ' '), o2s: document.querySelector('#o2').contentWindow.__size, o3: [...document.querySelector('#o3').contentDocument.querySelectorAll('svg *')].map(e => e.tagName + ':' + (e.getAttribute('stroke') || e.getAttribute('fill'))).slice(0, 4).join(',') }));
    console.log((i / FPS).toFixed(2), JSON.stringify(info)); } }
} else {
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', '-pix_fmt', 'yuv420p', '-r', String(FPS), a1], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let i = 0; i < frames; i++) { await step(i / FPS); const buf = await page.screenshot({ type: 'jpeg', quality: 97 }); if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r)); if (i % 150 === 0) console.log('frame', i, '/', frames); }
  ff.stdin.end(); await new Promise(r => ff.on('close', r));
}
console.log('actions', (await page.evaluate(() => window.log)).join(', ')); console.log('errs', errs.slice(0, 5).join(' | '));
await b.close();
