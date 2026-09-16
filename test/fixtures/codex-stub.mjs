#!/usr/bin/env node
// Test double for the Codex CLI. It replays a captured session so the review path
// can be verified without network access, credentials or quota.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

let prompt = '';
try {
  prompt = readFileSync(0, 'utf8');
} catch {
  prompt = '';
}

if (process.env.STUB_PROMPT_OUT) {
  writeFileSync(process.env.STUB_PROMPT_OUT, prompt, 'utf8');
}

if (process.env.STUB_ARGS_OUT) {
  writeFileSync(process.env.STUB_ARGS_OUT, JSON.stringify(args, null, 1), 'utf8');
}

if (process.env.STUB_ENV_NAME && process.env.STUB_ENV_OUT) {
  const name = process.env.STUB_ENV_NAME;
  writeFileSync(process.env.STUB_ENV_OUT, process.env[name] ? `present:${name}` : `missing:${name}`, 'utf8');
}

if (args[0] === 'login') {
  // Accept the API key on stdin exactly like the real CLI, but never record it.
  try {
    readFileSync(0, 'utf8');
  } catch {
    // the key is intentionally ignored
  }
  process.stderr.write('stub: logged in with API key\n');
  process.exit(0);
}

if (args[0] !== 'exec') {
  process.stderr.write(`stub only supports "exec" and "login", received: ${args.join(' ')}\n`);
  process.exit(64);
}

if (process.env.STUB_MODE === 'usage-limit') {
  process.stdout.write(`${JSON.stringify({ type: 'thread.started', thread_id: 'stub' })}\n`);
  process.stdout.write(`${JSON.stringify({ type: 'turn.started' })}\n`);
  process.stdout.write(
    `${JSON.stringify({
      type: 'turn.failed',
      error: { message: 'You have hit your usage limit. Try again at Sep 19th, 2026 5:37 PM.' },
    })}\n`,
  );
  process.exit(1);
}

const outputIndex = args.findIndex((arg) => arg === '-o' || arg === '--output-last-message');
const outputTarget = outputIndex >= 0 ? args[outputIndex + 1] : null;
if (outputTarget) {
  writeFileSync(outputTarget, readFileSync(path.join(here, 'last-message.json'), 'utf8'));
}

process.stderr.write(`stub: received ${prompt.length} characters of prompt\n`);
process.stdout.write(readFileSync(path.join(here, 'codex-events.jsonl'), 'utf8'));
process.exit(0);
