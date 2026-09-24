// InfrastructureAdapter. Build Day scope: only the local host, and only when the target is on loopback
// (otherwise these numbers would describe the wrong machine). Remote Linux/Windows agents come later.
import os from 'node:os';
import { statfs } from 'node:fs/promises';

export interface HostSnapshot {
  scope: 'local-host';
  hostname: string;
  platform: string;
  cpuModel: string;
  logicalCpus: number;
  cpuBusyPct: number; // sampled over sampleMs
  sampleMs: number;
  loadAvg: number[] | null; // not provided by Windows
  memTotalBytes: number;
  memFreeBytes: number;
  disk: { path: string; totalBytes: number; freeBytes: number; usedPct: number } | null;
}

export interface InfrastructureAdapter {
  appliesTo(host: string): boolean;
  snapshot(dataPath: string | null): Promise<HostSnapshot>;
}

function cpuTimes() {
  return os.cpus().reduce(
    (acc, c) => {
      const t = c.times;
      acc.idle += t.idle;
      acc.total += t.user + t.nice + t.sys + t.idle + t.irq;
      return acc;
    },
    { idle: 0, total: 0 },
  );
}

export class LocalHostAdapter implements InfrastructureAdapter {
  appliesTo(host: string): boolean {
    return ['127.0.0.1', 'localhost', '::1'].includes(host);
  }

  async snapshot(dataPath: string | null, sampleMs = 500): Promise<HostSnapshot> {
    const a = cpuTimes();
    await new Promise((r) => setTimeout(r, sampleMs));
    const b = cpuTimes();
    const busy = 1 - (b.idle - a.idle) / Math.max(b.total - a.total, 1);
    let disk: HostSnapshot['disk'] = null;
    if (dataPath) {
      const s = await statfs(dataPath);
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      disk = { path: dataPath, totalBytes: total, freeBytes: free, usedPct: Math.round((1 - free / total) * 1000) / 10 };
    }
    return {
      scope: 'local-host',
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      cpuModel: os.cpus()[0]?.model ?? 'unknown',
      logicalCpus: os.cpus().length,
      cpuBusyPct: Math.round(busy * 1000) / 10,
      sampleMs,
      loadAvg: process.platform === 'win32' ? null : os.loadavg(),
      memTotalBytes: os.totalmem(),
      memFreeBytes: os.freemem(),
      disk,
    };
  }
}
