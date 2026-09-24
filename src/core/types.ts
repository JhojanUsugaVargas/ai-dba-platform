// Engine-neutral domain types. Adapters (PostgreSQL today; SQL Server, Oracle, MySQL later) implement these contracts.

export type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Risk = 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Dimension = 'Availability' | 'Performance' | 'Storage' | 'Configuration' | 'Maintenance' | 'Backups' | 'Replication' | 'Security';
export const DIMENSIONS: Dimension[] = ['Availability', 'Performance', 'Storage', 'Configuration', 'Maintenance', 'Backups', 'Replication', 'Security'];

// 0 OBSERVE, 1 ANALYZE, 2 RECOMMEND, 3 SAFE_EXECUTION, 4 APPROVED_EXECUTION. Level 5 intentionally does not exist.
export type Autonomy = 0 | 1 | 2 | 3 | 4;
export const AUTONOMY_NAMES = ['OBSERVE', 'ANALYZE', 'RECOMMEND', 'SAFE_EXECUTION', 'APPROVED_EXECUTION'];

export interface Target {
  id: string;
  name: string;
  engine: 'postgresql' | 'oracle';
  host: string;
  port: number;
  database: string;
  ro_user: string;
  ro_secret_ref: string; // e.g. "env:DBA_AGENT_RO_PASSWORD" - a reference, never the secret itself
  exec_user: string;
  exec_secret_ref: string;
  autonomy_level: Autonomy;
}

export interface EvidenceDraft {
  source: string; // exact catalog view / function / OS API used
  data: unknown;
}

export interface CollectorContext {
  target: Target;
  budgetMs: number;
}

export interface CollectorDef {
  id: string;
  title: string;
  dimensions: Dimension[];
  timeoutMs: number;
  enabled: boolean;
  identity: 'ro' | 'host';
  run(ctx: CollectorContext): Promise<EvidenceDraft[]>;
}

export interface CollectorRun {
  collector: string;
  status: 'ok' | 'error' | 'skipped' | 'timeout';
  ms: number;
  evidenceIds: string[];
  dimensions: Dimension[];
  error?: string;
}

export interface Evidence {
  id: string;
  collector: string;
  source: string;
  data: any;
}

export interface CandidateAction {
  actionId: string;
  params: Record<string, unknown>;
}

export interface FindingDraft {
  ruleId: string;
  dimension: Dimension;
  severity: Severity;
  title: string;
  detail: string;
  object?: string;
  evidenceIds: string[];
  facts: Record<string, unknown>; // the exact numbers the rule used
  candidateActions: CandidateAction[];
}

export interface Finding extends FindingDraft {
  id: string;
}

export interface Rule {
  id: string;
  description: string;
  dimension: Dimension;
  evaluate(ev: EvidenceIndex): FindingDraft[];
}

export interface EvidenceIndex {
  byCollector(id: string): Evidence[];
  first(collector: string, source?: string): Evidence | undefined;
}

export interface PreconditionCheck {
  id: string;
  description: string;
  ok: boolean;
  observed: unknown;
}

export interface PreconditionResult {
  checks: PreconditionCheck[];
  state: Record<string, unknown>; // hashed into the approval fingerprint
}

export interface ActionImpl {
  buildSql(params: Record<string, any>): string;
  preconditions(params: Record<string, any>): Promise<PreconditionResult>;
  capture(params: Record<string, any>): Promise<Record<string, unknown>>; // baseline / after metrics (RO identity)
  verify(before: any, after: any): VerificationResult;
  estimate(params: Record<string, any>): Promise<Record<string, unknown>>;
}

export interface VerificationResult {
  outcome: 'IMPROVED' | 'NO_CHANGE' | 'DEGRADED' | 'INCONCLUSIVE';
  checks: { id: string; description: string; before: unknown; after: unknown; ok: boolean }[];
  summary: string;
}

export interface PermissionReport {
  identity: 'ro' | 'exec';
  user: string;
  verdict: 'OK' | 'REFUSED';
  checks: { id: string; description: string; ok: boolean; observed: unknown; critical: boolean }[];
  capabilities: string[];
}

export interface EngineAdapter {
  readonly engine: string;
  readonly supportedVersions: string;
  connectAndIdentify(): Promise<{ version: string; versionNum: number; supported: boolean }>;
  validatePermissions(): Promise<{ ro: PermissionReport; exec: PermissionReport }>;
  collectors(): CollectorDef[];
  rules(): Rule[];
  action(actionId: string): ActionImpl | undefined;
  executeAuthorized(sql: string, opts: { statementTimeoutMs: number; lockTimeoutMs: number }): Promise<{ ms: number; command: string }>;
  close(): Promise<void>;
}
