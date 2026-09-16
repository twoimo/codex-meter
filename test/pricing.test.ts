import test from 'node:test';
import assert from 'node:assert/strict';
import { costUsd, priceFor, roundUsd } from '../src/pricing.js';

test('exact model prices resolve without approximation', () => {
  const match = priceFor('gpt-5.4');
  assert.ok(match);
  assert.equal(match.model, 'gpt-5.4');
  assert.equal(match.approximate, false);
  assert.equal(match.price.input, 2.5);
});

test('variant names fall back to the closest published prefix', () => {
  const match = priceFor('gpt-5.4-codex');
  assert.ok(match);
  assert.equal(match.model, 'gpt-5.4');
  assert.equal(match.approximate, true);
});

test('unknown models report no price instead of guessing', () => {
  assert.equal(priceFor('some-unreleased-model'), null);
  assert.equal(priceFor(null), null);
});

test('cost accounting separates cached, cache-write, output and reasoning tokens', () => {
  const cost = costUsd(
    {
      inputTokens: 1_000_000,
      cachedInputTokens: 400_000,
      cacheWriteInputTokens: 100_000,
      outputTokens: 10_000,
      reasoningOutputTokens: 5_000,
    },
    { input: 2.5, cachedInput: 0.25, cacheWrite: 3, output: 15 },
  );

  assert.equal(roundUsd(cost.inputUsd), roundUsd(1.25));
  assert.equal(roundUsd(cost.cachedInputUsd), roundUsd(0.1));
  assert.equal(roundUsd(cost.cacheWriteUsd), roundUsd(0.3));
  assert.equal(roundUsd(cost.outputUsd), roundUsd(0.225));
  assert.equal(roundUsd(cost.totalUsd), roundUsd(1.875));
});

test('models without a cached-input rate are billed at the full input rate', () => {
  const cost = costUsd(
    {
      inputTokens: 1_000_000,
      cachedInputTokens: 500_000,
      cacheWriteInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    },
    { input: 30, cachedInput: null, cacheWrite: null, output: 180 },
  );
  // 500k uncached tokens at $30/M plus 500k cached tokens priced at null => 0
  assert.equal(roundUsd(cost.totalUsd), roundUsd(15));
});

test('custom pricing tables override the published defaults', () => {
  const match = priceFor('internal-model', { 'internal-model': { input: 1, cachedInput: null, cacheWrite: null, output: 2 } });
  assert.ok(match);
  assert.equal(match.price.output, 2);
});
