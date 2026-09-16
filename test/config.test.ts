import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFileConfig, DEFAULT_CONFIG } from '../src/config.js';

test('unknown keys are reported instead of silently ignored', () => {
  const { config, unknownKeys } = applyFileConfig(DEFAULT_CONFIG, { nonsense: true, budget: { tokensPerRun: 10, typo: 5 } });
  assert.deepEqual(unknownKeys.sort(), ['budget.typo', 'nonsense']);
  assert.equal(config.budget.tokensPerRun, 10);
});

test('budget, state and model overrides are applied', () => {
  const { config } = applyFileConfig(DEFAULT_CONFIG, {
    model: 'gpt-5.4',
    budget: { tokensPerMonth: 250_000, usdPerMonth: 3, tokensPerRun: null },
    state: { mode: 'branch', branch: 'meter-state' },
    comment: 'off',
    failOn: 'critical',
  });

  assert.equal(config.model, 'gpt-5.4');
  assert.equal(config.budget.tokensPerMonth, 250_000);
  assert.equal(config.budget.usdPerMonth, 3);
  assert.equal(config.budget.tokensPerRun, null);
  assert.equal(config.state.mode, 'branch');
  assert.equal(config.state.branch, 'meter-state');
  assert.equal(config.comment, 'off');
  assert.equal(config.failOn, 'critical');
});

test('invalid enum values are ignored', () => {
  const { config } = applyFileConfig(DEFAULT_CONFIG, { state: { mode: 'database' }, comment: 'spam', failOn: 'blocker' });
  assert.equal(config.state.mode, DEFAULT_CONFIG.state.mode);
  assert.equal(config.comment, DEFAULT_CONFIG.comment);
  assert.equal(config.failOn, DEFAULT_CONFIG.failOn);
});

test('pricing entries merge over the published defaults and must be numeric', () => {
  const { config } = applyFileConfig(DEFAULT_CONFIG, {
    pricing: {
      'internal-codex': { input: 1, output: 2, cachedInput: 0.1 },
      broken: { input: 'x' },
    },
  });

  assert.equal(config.pricing['internal-codex']?.cacheWrite, null);
  assert.equal(config.pricing['gpt-5.4']?.input, 2.5);
  assert.equal(config.pricing['broken'], undefined);
});

test('estimate overrides are applied without losing the other fields', () => {
  const { config } = applyFileConfig(DEFAULT_CONFIG, { estimate: { baselineTokens: 25_000 } });
  assert.equal(config.estimate.baselineTokens, 25_000);
  assert.equal(config.estimate.tokensPerChangedLine, DEFAULT_CONFIG.estimate.tokensPerChangedLine);
});

test('a custom provider is parsed and defaults to the responses wire API', () => {
  const { config, unknownKeys } = applyFileConfig(DEFAULT_CONFIG, {
    provider: {
      name: 'opencode-go',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      envKey: 'OPENCODE_API_KEY',
      model: 'deepseek-v4.1-flash',
    },
  });
  assert.deepEqual(unknownKeys, []);
  assert.equal(config.provider?.name, 'opencode-go');
  assert.equal(config.provider?.wireApi, 'responses');
  assert.equal(config.provider?.model, 'deepseek-v4.1-flash');
});

test('an incomplete or invalid provider block is reported, not half-applied', () => {
  const missingEnv = applyFileConfig(DEFAULT_CONFIG, { provider: { name: 'x', baseUrl: 'https://x/v1' } });
  assert.equal(missingEnv.config.provider, null);
  assert.ok(missingEnv.unknownKeys.includes('provider'));

  const badWire = applyFileConfig(DEFAULT_CONFIG, {
    provider: { name: 'x', baseUrl: 'https://x/v1', envKey: 'X_KEY', wireApi: 'grpc' },
  });
  assert.equal(badWire.config.provider, null);
  assert.ok(badWire.unknownKeys.includes('provider.wireApi'));

  const cleared = applyFileConfig(DEFAULT_CONFIG, { provider: null });
  assert.equal(cleared.config.provider, null);
});

test('the default configuration ships a usable monthly budget', () => {
  assert.equal(DEFAULT_CONFIG.budget.tokensPerMonth, 1_200_000);
  assert.equal(DEFAULT_CONFIG.allowForkPrs, false);
  assert.equal(DEFAULT_CONFIG.failOn, 'high');
});
