// Verifies the configured Anthropic credential without spending tokens (Models API metadata lookup).
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';

process.loadEnvFile('.env');
const model = JSON.parse(readFileSync('config/models.json', 'utf8')).routes.MEDIUM.model;
try {
  const m = await new Anthropic({ maxRetries: 0 }).models.retrieve(model);
  console.log(`OK: credential accepted; ${m.id} available (${m.display_name}).`);
} catch (e) {
  if (e instanceof Anthropic.AuthenticationError) console.log('FAIL: credential rejected (401). Check the key in .env.');
  else if (e instanceof Anthropic.PermissionDeniedError) console.log(`FAIL: credential valid but no access to ${model} (403).`);
  else if (e instanceof Anthropic.NotFoundError) console.log(`FAIL: model ${model} not found for this account (404).`);
  else console.log(`FAIL: ${(e as Error).message}`);
  process.exitCode = 1;
}
