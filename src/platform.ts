// Composition root: wires store, audit, adapters, LLM, notifications and identities.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store, pj } from './core/store.ts';
import { Audit } from './core/audit.ts';
import type { EngineAdapter, PermissionReport, Target } from './core/types.ts';
import { createAdapter } from './adapters/index.ts';
import { AnthropicProvider, type LlmProvider } from './agent/llm.ts';
import { ConsoleNotifier, NotificationHub, OutboxNotifier } from './notify/notifier.ts';

export interface Identity {
  id: string;
  name: string;
  roles: string[];
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class Platform {
  readonly root: string;
  readonly store: Store;
  readonly audit: Audit;
  readonly llm: LlmProvider;
  readonly notify: NotificationHub;
  readonly identities: Identity[];
  private adapters = new Map<string, EngineAdapter>();

  constructor(root: string, dbPath = join(root, 'data', 'platform.db')) {
    this.root = root;
    this.store = new Store(dbPath);
    this.audit = new Audit(this.store);
    this.llm = new AnthropicProvider(root);
    this.notify = new NotificationHub([new ConsoleNotifier(), new OutboxNotifier(this.store, join(root, 'outbox'), process.env.ALERT_EMAIL_TO ?? 'dba-team@example.com')]);
    this.identities = JSON.parse(readFileSync(join(root, 'config', 'identities.json'), 'utf8')).identities;
  }

  // Simulated identity for the Build Day (no real login). Authorization is still enforced per role.
  actor(id: string | undefined, role?: string): Identity {
    const who = this.identities.find((i) => i.id === id);
    if (!who) throw new HttpError(401, `Unknown identity: ${id ?? '(none)'}`);
    if (role && !who.roles.includes(role)) throw new HttpError(403, `${who.id} lacks role '${role}'`);
    return who;
  }

  target(id: string): Target & Record<string, any> {
    const t = this.store.get('SELECT * FROM targets WHERE id = ?', id);
    if (!t) throw new HttpError(404, `Target ${id} not found`);
    return { ...(t as any), autonomy_level: Number(t.autonomy_level), permission_report: pj(t.permission_report) };
  }

  execReport(targetId: string): PermissionReport | null {
    return this.target(targetId).permission_report?.exec ?? null;
  }

  adapter(target: Target): EngineAdapter {
    let a = this.adapters.get(target.id);
    if (!a) {
      const disabled = new Set((process.env.DISABLED_COLLECTORS ?? '').split(',').map((s) => s.trim()).filter(Boolean));
      a = createAdapter(target, this.root, disabled);
      this.adapters.set(target.id, a);
    }
    return a;
  }

  killSwitch(): { engaged: boolean; by?: string; at?: string; reason?: string } {
    return pj(this.store.getSetting('kill_switch') ?? 'null') ?? { engaged: false };
  }

  async close() {
    await Promise.all([...this.adapters.values()].map((a) => a.close()));
  }
}
