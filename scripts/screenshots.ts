// Captures each UI tab with headless Edge (visual check without a browser extension). Dev utility.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const EDGE = process.env.EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const out = resolve(process.argv[2] ?? 'screenshots');
const tabs = (process.argv[3] ?? 'overview,findings,changes,assessment,audit').split(',');
mkdirSync(out, { recursive: true });
for (const tab of tabs) {
  const file = join(out, `${tab}.png`);
  execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1400,2600', '--virtual-time-budget=6000', `--screenshot=${file}`, `http://127.0.0.1:8787/#${tab}`], { stdio: 'ignore' });
  console.log(file);
}
