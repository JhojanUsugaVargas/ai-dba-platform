// Engine adapter registry. Adding SQL Server / MySQL = one adapter directory + one line here.
import type { EngineAdapter, Target } from '../core/types.ts';
import { PostgresAdapter } from './postgres/adapter.ts';
import { OracleAdapter } from './oracle/adapter.ts';

export function createAdapter(target: Target, root: string, disabled?: Set<string>): EngineAdapter {
  if (target.engine === 'postgresql') return new PostgresAdapter(target, root, disabled);
  if (target.engine === 'oracle') return new OracleAdapter(target, root, disabled);
  throw new Error(`No adapter for engine ${target.engine} (SQL Server and MySQL adapters are planned)`);
}
