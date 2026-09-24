// Appends a step to the designer live feed (public/live/progress.json). Optional screenshot of a UI tab.
// Usage: node scripts/live-log.ts "<title>" "<detail>" [running|done] [tab-to-screenshot]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(import.meta.dirname, '..', 'public', 'live');
mkdirSync(dir, { recursive: true });
const file = join(dir, 'progress.json');
const [title, detail = '', status = 'done', tab] = process.argv.slice(2);
const steps = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
if (steps.length && steps[steps.length - 1].status === 'running') steps[steps.length - 1].status = 'done';
const ts = new Date().toISOString();
let shot: string | undefined;
if (tab) {
  shot = `shot-${steps.length + 1}-${tab}.png`;
  const edge = process.env.EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  execFileSync(edge, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1400,1800', '--virtual-time-budget=6000', `--screenshot=${join(dir, shot)}`, `http://127.0.0.1:8787/#${tab}`], { stdio: 'ignore' });
}
steps.push({ ts, title, detail, status, shot });
writeFileSync(file, JSON.stringify(steps, null, 2));
console.log(`logged: ${title}`);
