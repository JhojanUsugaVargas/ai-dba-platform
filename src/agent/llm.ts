// Model-agnostic LLM boundary. The rest of the platform only sees LlmProvider; swapping models or vendors
// does not touch assessment, policy or execution code. Routing and prices live in config/models.json.
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Complexity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface LlmRequest {
  complexity: Complexity;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}

export interface LlmResult {
  output: unknown;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costUsd: number | null;
  stopReason: string | null;
}

export interface LlmProvider {
  readonly name: string;
  available(): boolean;
  structured(req: LlmRequest): Promise<LlmResult>;
}

interface ModelsConfig {
  models: Record<string, { input_per_mtok: number; output_per_mtok: number }>;
  routes: Record<Complexity, { model: string; effort: string | null }>;
}

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private cfg: ModelsConfig;
  private client?: Anthropic;

  constructor(root: string) {
    this.cfg = JSON.parse(readFileSync(join(root, 'config', 'models.json'), 'utf8'));
  }

  available(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  }

  async structured(req: LlmRequest): Promise<LlmResult> {
    const route = this.cfg.routes[req.complexity];
    const model = process.env.AI_DBA_MODEL_OVERRIDE || route.model;
    this.client ??= new Anthropic({ timeout: 120_000, maxRetries: 2 });
    const t0 = performance.now();
    const output_config: Record<string, unknown> = { format: { type: 'json_schema', schema: req.schema } };
    const effort = process.env.AI_DBA_EFFORT_OVERRIDE || route.effort;
    if (effort && !model.startsWith('claude-haiku')) output_config.effort = effort;
    const response = await this.client.messages.create({
      model,
      max_tokens: req.maxTokens ?? 16000,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      output_config,
    } as Anthropic.MessageCreateParamsNonStreaming);
    const latencyMs = Math.round(performance.now() - t0);
    if (response.stop_reason === 'refusal') throw new Error('Model declined the request (stop_reason=refusal)');
    if (response.stop_reason === 'max_tokens') throw new Error('Model output truncated (stop_reason=max_tokens)');
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    const price = this.cfg.models[model];
    const u = response.usage;
    return {
      output: JSON.parse(text),
      model: response.model,
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      latencyMs,
      costUsd: price ? (u.input_tokens * price.input_per_mtok + u.output_tokens * price.output_per_mtok) / 1e6 : null,
      stopReason: response.stop_reason,
    };
  }
}
