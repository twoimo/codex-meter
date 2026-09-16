import test from 'node:test';
import assert from 'node:assert/strict';
import { monthTotals, parseLedger, serializeRecord, summarize, wasReviewed } from '../src/ledger.js';
import type { LedgerRecord } from '../src/types.js';

function record(overrides: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    schema: 1,
    ts: '2026-09-16T10:00:00.000Z',
    repo: 'twoimo/codex-meter',
    pr: 12,
    sha: 'abc123',
    base: 'main',
    decision: 'run',
    code: 'run',
    tier: 'review',
    model: 'gpt-5.4',
    usage: { inputTokens: 20_000, cachedInputTokens: 12_000, cacheWriteInputTokens: 0, outputTokens: 500, reasoningOutputTokens: 100 },
    estCostUsd: 0.02,
    durationMs: 42_000,
    findings: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
    toolVersion: '0.1.0',
    note: null,
    ...overrides,
  };
}

test('ledger round-trips through JSONL and ignores junk lines', () => {
  const text = `${serializeRecord(record())}not json\n{"schema":1,"ts":"2026-09-16T10:00:00.000Z","code":"run"}\n`;
  const parsed = parseLedger(text);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]?.pr, 12);
});

test('monthTotals sums runs and counts skips separately', () => {
  const totals = monthTotals(
    [
      record(),
      record({ sha: 'def456', estCostUsd: 0.01 }),
      record({ decision: 'skip', code: 'docs-only', tier: 'none', usage: { inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 }, estCostUsd: null }),
      record({ ts: '2026-08-31T10:00:00.000Z', sha: 'old' }),
    ],
    { month: '2026-09' },
  );

  assert.equal(totals.runs, 2);
  assert.equal(totals.skipped, 1);
  assert.equal(totals.tokens, 2 * (20_000 + 500 + 100));
  assert.equal(totals.usd, 0.03);
  assert.equal(totals.usdComplete, true);
});

test('unknown costs mark the monthly total as incomplete', () => {
  const totals = monthTotals([record({ estCostUsd: null })], { month: '2026-09' });
  assert.equal(totals.usdComplete, false);
});

test('wasReviewed only matches runs with the same head commit', () => {
  const records = [record()];
  assert.equal(wasReviewed(records, { repo: 'twoimo/codex-meter', pr: 12, sha: 'abc123' }), true);
  assert.equal(wasReviewed(records, { repo: 'twoimo/codex-meter', pr: 12, sha: 'zzz' }), false);
  assert.equal(wasReviewed(records, { repo: 'other/repo', pr: 12, sha: 'abc123' }), false);
  assert.equal(wasReviewed(records, { repo: null, pr: null, sha: null }), false);
});

test('summarize reports skip reasons, severities and cache reuse', () => {
  const summary = summarize(
    [
      record(),
      record({ sha: 'def456', findings: { critical: 1, high: 0, medium: 2, low: 0, info: 0 }, estCostUsd: 0.05 }),
      record({ sha: 'ghi789', decision: 'skip', code: 'docs-only', tier: 'none', estCostUsd: null }),
      record({ sha: 'jkl012', decision: 'budget-stop', code: 'budget-exhausted', tier: 'none', estCostUsd: null }),
    ],
    { month: '2026-09', repo: 'twoimo/codex-meter' },
  );

  assert.equal(summary.totals.runs, 2);
  assert.equal(summary.totals.skipped, 2);
  assert.deepEqual(summary.skipReasons, [
    { code: 'docs-only', count: 1 },
    { code: 'budget-exhausted', count: 1 },
  ]);
  assert.equal(summary.severities.critical, 1);
  assert.equal(summary.severities.high, 1);
  assert.equal(summary.severities.medium, 2);
  assert.equal(summary.reviewsWithFindings, 2);
  assert.equal(summary.cacheHitRatio, 0.6);
  assert.equal(summary.topSpend.length, 2);
  assert.ok(summary.topSpend[0]!.tokens >= summary.topSpend[1]!.tokens);
});

test('summary scopes to the requested month', () => {
  const summary = summarize([record({ ts: '2026-08-01T00:00:00.000Z' })], { month: '2026-09' });
  assert.equal(summary.totals.runs, 0);
});
