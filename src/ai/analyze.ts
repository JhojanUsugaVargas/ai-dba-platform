import { Anthropic } from '@anthropic-ai/sdk';

/**
 * Call Anthropic Claude model to generate analysis/recommendations based on
 * collected performance metrics and optional data‑quality report.
 */
export async function analyzeReport(payload: any): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const prompt = `You are an AI DBA assistant. Based on the following information, provide concise, actionable recommendations for database performance and data quality improvements. Return the answer in plain text (no markdown).

Metrics:
${JSON.stringify(payload.metrics, null, 2)}

Data‑Quality Report:
${JSON.stringify(payload.dataCheck, null, 2)}
`;

  const response = await client.completions.create({
    model: 'claude-3-5-sonnet-20240620',
    max_tokens: 1024,
    temperature: 0,
    prompt,
  });
  return response.completion;
}
