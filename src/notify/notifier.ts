// Notification boundary. Build Day channels: Console + Outbox (persisted, visible in the UI, .eml file on disk).
// EmailNotifier/WebhookNotifier plug in here later without touching callers.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Store } from '../core/store.ts';
import type { Severity } from '../core/types.ts';
import { log, newId, nowIso, redactSecrets } from '../core/util.ts';

export interface Alert {
  severity: Severity;
  subject: string;
  target: string;
  engine: string;
  event: string;
  evidence: unknown;
  probableCause?: string;
  impact?: string;
  recommendation?: string;
  action?: string;
  status: string;
}

export interface Notifier {
  readonly channel: string;
  send(alert: Alert): Promise<void>;
}

export class ConsoleNotifier implements Notifier {
  readonly channel = 'console';
  async send(a: Alert) {
    log('warn', `ALERT ${a.severity} ${a.subject}`, { target: a.target, event: a.event, status: a.status });
  }
}

export class OutboxNotifier implements Notifier {
  readonly channel = 'email-outbox';
  private store: Store;
  private dir: string;
  private to: string;
  constructor(store: Store, dir: string, to: string) {
    this.store = store;
    this.dir = dir;
    this.to = to;
  }
  async send(a: Alert) {
    const id = newId('ntf');
    const ts = nowIso();
    const body = redactSecrets(a);
    const text = [
      `Severity: ${a.severity}`, `Timestamp: ${ts}`, `Target: ${a.target}`, `Engine: ${a.engine}`, `Event: ${a.event}`,
      `Probable cause: ${a.probableCause ?? 'n/a'}`, `Impact: ${a.impact ?? 'n/a'}`, `Recommendation: ${a.recommendation ?? 'n/a'}`,
      `Action: ${a.action ?? 'n/a'}`, `Status: ${a.status}`, '', 'Evidence:', JSON.stringify(body.evidence, null, 2),
    ].join('\n');
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${ts.replace(/[:.]/g, '-')}_${id}.eml`), `To: ${this.to}\nFrom: ai-dba-platform@localhost\nSubject: [AI DBA][${a.severity}] ${a.subject}\nContent-Type: text/plain; charset=utf-8\n\n${text}\n`);
    this.store.run('INSERT INTO notifications(id, ts, channel, severity, subject, body, delivery) VALUES (?,?,?,?,?,?,?)', id, ts, this.channel, a.severity, a.subject, JSON.stringify(body), 'QUEUED_LOCAL_OUTBOX (SMTP not configured)');
  }
}

export class NotificationHub {
  private notifiers: Notifier[];
  constructor(notifiers: Notifier[]) {
    this.notifiers = notifiers;
  }
  async alert(a: Alert) {
    await Promise.all(this.notifiers.map((n) => n.send(a).catch((e) => log('error', 'notifier failed', { channel: n.channel, error: (e as Error).message }))));
  }
}
