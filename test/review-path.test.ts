import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixtureRepo, installCodexStub, runCli } from './helpers.js';
import type { LedgerRecord } from '../src/types.js';

function readLedger(text: string): LedgerRecord[] {
  return text
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line) as LedgerRecord);
}

/** The recorded review fixture reports one critical and one high finding. */
test('the full review path runs, meters and records a real session', async () => {
  const dir = await fixtureRepo([['src/upload.ts', 'export const uploader = 1;\n']]);
  const stub = await installCodexStub();
  const promptOut = path.join(dir, 'prompt.txt');

  const result = await runCli(
    ['review', '--cwd', dir, '--base', 'main', '--codex-bin', stub, '--model', 'gpt-5.4', '--json'],
    dir,
    { STUB_PROMPT_OUT: promptOut },
  );

  // One critical finding is at or above the default fail-on threshold (high).
  assert.equal(result.code, 1);

  const payload = JSON.parse(result.stdout) as Record<string, any>;
  assert.equal(payload.result.errorKind, 'none');
  assert.equal(payload.result.usage.inputTokens, 116_593);
  assert.equal(payload.result.usage.cachedInputTokens, 103_955);
  assert.equal(payload.result.usage.outputTokens, 4_642);
  assert.equal(payload.result.findings.critical, 1);
  assert.equal(payload.result.findings.high, 1);
  assert.equal(payload.result.model, 'gpt-5.4');

  // 12,638 uncached in @ $2.50/M + 103,955 cached @ $0.25/M + 4,642 out @ $15/M
  assert.ok(Math.abs(payload.result.costUsd - 0.127214) < 0.0005, `unexpected cost ${payload.result.costUsd}`);

  const ledger = readLedger(await readFile(path.join(dir, '.codex-meter', 'ledger.jsonl'), 'utf8'));
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0]?.decision, 'run');
  assert.equal(ledger[0]?.model, 'gpt-5.4');
  assert.equal(ledger[0]?.findings.critical, 1);
  assert.equal(ledger[0]?.estCostUsd, payload.result.costUsd);
  assert.ok((ledger[0]?.durationMs ?? 0) > 0);

  const prompt = await readFile(promptOut, 'utf8');
  assert.ok(prompt.includes('git diff main...'), 'the base ref is spelled out for the agent');
  assert.ok(prompt.includes('Report only defects a maintainer would act on'.slice(0, 20)));

  // The ledger, not the review body, is what stops a second run on the same commit.
  const second = await runCli(['explain', '--cwd', dir, '--base', 'main', '--json'], dir);
  const secondPayload = JSON.parse(second.stdout) as Record<string, any>;
  assert.equal(secondPayload.decision.code, 'already-reviewed');
});

test('a usage-limit failure is recorded without blocking the pull request', async () => {
  const dir = await fixtureRepo([['src/upload.ts', 'export const uploader = 2;\n']]);
  const stub = await installCodexStub();

  const result = await runCli(['review', '--cwd', dir, '--base', 'main', '--codex-bin', stub, '--json'], dir, {
    STUB_MODE: 'usage-limit',
  });

  assert.equal(result.code, 0, 'infrastructure failures must not fail the check');
  assert.ok(result.stderr.includes('usage limit'));

  const payload = JSON.parse(result.stdout) as Record<string, any>;
  assert.equal(payload.result.errorKind, 'nonzero');
  assert.match(payload.result.failureReason, /usage limit/i);

  const ledger = readLedger(await readFile(path.join(dir, '.codex-meter', 'ledger.jsonl'), 'utf8'));
  assert.equal(ledger[0]?.decision, 'error');
  assert.match(ledger[0]?.note ?? '', /usage limit/i);
});

test('pull requests from forks are skipped before any key is used', async () => {
  const dir = await fixtureRepo([['src/upload.ts', 'export const uploader = 3;\n']]);
  const stub = await installCodexStub();
  const eventPath = path.join(dir, 'event.json');
  await writeFile(
    eventPath,
    JSON.stringify({
      pull_request: {
        number: 42,
        title: 'Retry the upload',
        draft: false,
        user: { login: 'outsider' },
        labels: [],
        head: { sha: 'f'.repeat(40), repo: { full_name: 'outsider/fork' } },
        base: { ref: 'main', repo: { full_name: 'twoimo/codex-meter' } },
      },
    }),
    'utf8',
  );

  const result = await runCli(['review', '--cwd', dir, '--base', 'main', '--codex-bin', stub, '--json'], dir, {
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: 'twoimo/codex-meter',
  });

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout) as Record<string, any>;
  assert.equal(payload.decision.code, 'fork-pr');

  const ledger = readLedger(await readFile(path.join(dir, '.codex-meter', 'ledger.jsonl'), 'utf8'));
  assert.equal(ledger[0]?.decision, 'skip');
  assert.equal(ledger[0]?.usage.inputTokens, 0);
});

test('dry runs decide but never spend or write state', async () => {
  const dir = await fixtureRepo([['src/upload.ts', 'export const uploader = 4;\n']]);
  const stub = await installCodexStub();

  const result = await runCli(['review', '--cwd', dir, '--base', 'main', '--codex-bin', stub, '--dry-run', '--json'], dir);

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout) as Record<string, any>;
  assert.equal(payload.decision.run, true);
  assert.equal(payload.result, undefined);

  await assert.rejects(readFile(path.join(dir, '.codex-meter', 'ledger.jsonl'), 'utf8'));
});

test('the monthly budget stops reviews once it is spent', async () => {
  const dir = await fixtureRepo([['src/upload.ts', 'export const uploader = 5;\n']]);
  const stub = await installCodexStub();

  const result = await runCli(
    ['review', '--cwd', dir, '--base', 'main', '--codex-bin', stub, '--budget-tokens', '1000', '--json'],
    dir,
  );

  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout) as Record<string, any>;
  assert.equal(payload.decision.code, 'budget-exhausted');
  assert.equal(payload.result, undefined);
});
