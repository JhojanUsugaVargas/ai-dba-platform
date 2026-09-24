// Append-only, hash-chained audit trail: hash_n = SHA256(hash_{n-1} + canonical(event_n)).
import type { Store } from './store.ts';
import { canonicalJson, newId, nowIso, redactSecrets, sha256 } from './util.ts';

export const GENESIS = '0'.repeat(64);

export interface AuditInput {
  actor: string;
  type: string;
  target?: string | null;
  changeId?: string | null;
  payload: Record<string, unknown>;
}

export class Audit {
  private store: Store;
  constructor(store: Store) {
    this.store = store;
  }

  write(e: AuditInput): { id: string; hash: string } {
    return this.store.tx(() => {
      const prev = (this.store.get('SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1')?.hash as string) ?? GENESIS;
      const event = {
        id: newId('evt'),
        ts: nowIso(),
        actor: e.actor,
        event_type: e.type,
        target: e.target ?? null,
        change_id: e.changeId ?? null,
        payload: redactSecrets(e.payload),
      };
      const hash = sha256(prev + canonicalJson(event));
      this.store.run(
        'INSERT INTO audit_events(id, ts, actor, event_type, target, change_id, payload, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?)',
        event.id, event.ts, event.actor, event.event_type, event.target, event.change_id, canonicalJson(event.payload), prev, hash,
      );
      return { id: event.id, hash };
    });
  }

  list(limit = 200, changeId?: string) {
    const rows = changeId
      ? this.store.all('SELECT * FROM audit_events WHERE change_id = ? ORDER BY seq DESC LIMIT ?', changeId, limit)
      : this.store.all('SELECT * FROM audit_events ORDER BY seq DESC LIMIT ?', limit);
    return rows.map((r) => ({ ...r, payload: JSON.parse(String(r.payload)) }));
  }

  // Recomputes the whole chain; any edited, inserted or removed event breaks it.
  verify(): { valid: boolean; events: number; brokenAt?: number; reason?: string } {
    let prev = GENESIS;
    const rows = this.store.all('SELECT * FROM audit_events ORDER BY seq ASC');
    for (const r of rows) {
      const event = {
        id: r.id, ts: r.ts, actor: r.actor, event_type: r.event_type,
        target: r.target ?? null, change_id: r.change_id ?? null, payload: JSON.parse(String(r.payload)),
      };
      if (r.prev_hash !== prev) return { valid: false, events: rows.length, brokenAt: Number(r.seq), reason: 'prev_hash mismatch' };
      if (sha256(prev + canonicalJson(event)) !== r.hash) return { valid: false, events: rows.length, brokenAt: Number(r.seq), reason: 'hash mismatch' };
      prev = String(r.hash);
    }
    return { valid: true, events: rows.length };
  }
}
