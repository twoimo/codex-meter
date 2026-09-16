import test from 'node:test';
import assert from 'node:assert/strict';
import { breakDown, classifyPath, decide, estimateTokens } from '../src/policy.js';
import { DEFAULT_CONFIG } from '../src/config.js';
function stats(entries) {
    const files = entries.map(([path, added, deleted]) => ({
        path,
        added,
        deleted,
        binary: false,
        status: 'modified',
    }));
    const added = files.reduce((sum, file) => sum + file.added, 0);
    const deleted = files.reduce((sum, file) => sum + file.deleted, 0);
    return { files, fileCount: files.length, added, deleted, changedLines: added + deleted };
}
function input(overrides = {}) {
    return {
        config: structuredClone(DEFAULT_CONFIG),
        stats: stats([['src/app.ts', 20, 4]]),
        budget: { monthTokens: 0, monthUsd: 0, runTokens: 0, runUsd: 0 },
        pull: { number: 7, title: 'test', draft: false, author: 'contributor', labels: [], isFork: false },
        alreadyReviewed: false,
        hasCredential: true,
        now: '2026-09-16T00:00:00.000Z',
        ...overrides,
    };
}
test('classifyPath separates docs, locks, generated files and code', () => {
    assert.equal(classifyPath('README.md'), 'docs');
    assert.equal(classifyPath('package-lock.json'), 'lock');
    assert.equal(classifyPath('dist/bundle.js'), 'generated');
    assert.equal(classifyPath('assets/logo.png'), 'generated');
    assert.equal(classifyPath('src/index.ts'), 'source');
    assert.equal(classifyPath('.github/workflows/ci.yml'), 'ci');
    assert.equal(classifyPath('test/api.test.ts'), 'test');
});
test('breakDown flags docs-only and generated-only diffs', () => {
    assert.equal(breakDown(stats([['docs/a.md', 3, 1]])).docsOnly, true);
    assert.equal(breakDown(stats([['package-lock.json', 100, 2], ['yarn.lock', 5, 5]])).generatedOnly, true);
    assert.equal(breakDown(stats([['src/a.ts', 3, 1], ['README.md', 1, 0]])).docsOnly, false);
});
test('estimateTokens scales with changed lines', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    const small = estimateTokens(stats([['src/a.ts', 5, 0]]), config);
    const large = estimateTokens(stats([['src/a.ts', 500, 0]]), config);
    assert.ok(large.input > small.input);
    assert.equal(small.input, config.estimate.baselineTokens + 5 * config.estimate.tokensPerChangedLine);
});
test('a normal source change is approved for review', () => {
    const outcome = decide(input());
    assert.equal(outcome.decision.run, true);
    assert.equal(outcome.decision.code, 'run');
    assert.ok(outcome.estimate.input > 0);
});
test('cheap gates run before expensive ones', () => {
    const draft = decide(input({ pull: { number: 1, title: null, draft: true, author: null, labels: [], isFork: false } }));
    assert.equal(draft.decision.code, 'draft');
    const labelled = decide(input({ pull: { number: 1, title: null, draft: false, author: null, labels: ['skip-codex-meter'], isFork: false } }));
    assert.equal(labelled.decision.code, 'label-skip');
    const fork = decide(input({ pull: { number: 1, title: null, draft: false, author: 'stranger', labels: [], isFork: true } }));
    assert.equal(fork.decision.code, 'fork-pr');
    assert.match(fork.decision.detail, /fork/i);
});
test('docs-only and lockfile-only diffs are skipped without spending', () => {
    assert.equal(decide(input({ stats: stats([['README.md', 10, 2]]) })).decision.code, 'docs-only');
    assert.equal(decide(input({ stats: stats([['package-lock.json', 500, 20]]) })).decision.code, 'generated-only');
});
test('oversized diffs are refused with an actionable message', () => {
    const outcome = decide(input({ stats: stats([['src/big.ts', 4000, 500]]) }));
    assert.equal(outcome.decision.run, false);
    assert.equal(outcome.decision.code, 'too-large');
    assert.match(outcome.decision.detail, /4500 changed lines/);
});
test('minChangedLines can gate trivial changes', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.minChangedLines = 10;
    assert.equal(decide(input({ config, stats: stats([['src/a.ts', 2, 0]]) })).decision.code, 'too-small');
});
test('an already metered head commit is not reviewed twice', () => {
    assert.equal(decide(input({ alreadyReviewed: true })).decision.code, 'already-reviewed');
});
test('missing credentials stop the run instead of failing the pull request', () => {
    assert.equal(decide(input({ hasCredential: false })).decision.code, 'no-credential');
});
test('monthly token budget is enforced before spending', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.budget.tokensPerMonth = 30_000;
    const outcome = decide(input({ config, budget: { monthTokens: 29_000, monthUsd: 0, runTokens: 0, runUsd: 0 } }));
    assert.equal(outcome.decision.code, 'budget-exhausted');
    assert.equal(outcome.decision.run, false);
});
test('per-run token cap is enforced', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.budget.tokensPerRun = 100;
    assert.equal(decide(input({ config })).decision.code, 'budget-exhausted');
});
test('dollar budget needs a known price and is enforced when present', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.model = 'gpt-5.4';
    config.budget.usdPerMonth = 0.5;
    config.budget.tokensPerRun = null;
    const expensive = decide(input({ config, stats: stats([['src/a.ts', 3000, 0]]) }));
    assert.equal(expensive.decision.code, 'budget-exhausted');
    assert.ok(expensive.estimate.usd !== null && expensive.estimate.usd > 0.5);
    const unknownModel = structuredClone(config);
    unknownModel.model = 'totally-unknown-model';
    const outcome = decide(input({ config: unknownModel }));
    assert.equal(outcome.decision.code, 'run');
    assert.ok(outcome.decision.notes.some((note) => note.includes('dollar budget was not enforced')));
});
test('approximate price matches are reported as a note', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.model = 'gpt-5.4-codex';
    const outcome = decide(input({ config }));
    assert.equal(outcome.decision.run, true);
    assert.equal(outcome.estimate.priceApproximate, true);
    assert.ok(outcome.decision.notes.some((note) => note.includes('gpt-5.4')));
});
//# sourceMappingURL=policy.test.js.map