import test from 'node:test';
import assert from 'node:assert/strict';
import { displayBase, renderReportMarkdown, renderReviewComment, renderSkipComment, sortFindings } from '../src/render.js';
import { summarize } from '../src/ledger.js';
const review = {
    summary: 'Adds a retry loop around the upload call.',
    risk: 'medium',
    skipReview: false,
    findings: [
        { severity: 'low', file: 'src/a.ts', line: 4, title: 'Minor', detail: null, suggestion: null, confidence: null },
        { severity: 'critical', file: 'src/a|b.ts', line: null, title: 'Unbounded retry', detail: 'Retries forever on 5xx.', suggestion: 'Cap attempts.', confidence: 0.8 },
    ],
};
const spend = {
    usage: { inputTokens: 18_193, cachedInputTokens: 1_000, cacheWriteInputTokens: 0, outputTokens: 240, reasoningOutputTokens: 60 },
    costUsd: 0.0042,
    model: 'gpt-5.4',
    monthTokens: 120_000,
    monthTokenBudget: 1_000_000,
    monthUsd: null,
    monthUsdBudget: null,
};
test('findings are ordered by severity then location', () => {
    const sorted = sortFindings(review.findings);
    assert.equal(sorted[0]?.severity, 'critical');
    assert.equal(sorted[1]?.severity, 'low');
});
test('review comment carries the upsert marker and escapes table pipes', () => {
    const body = renderReviewComment({
        review,
        spend,
        meta: { shortSha: 'abc12345', base: 'main', toolVersion: '0.1.0', durationMs: 30_000, droppedFindings: 0 },
    });
    assert.ok(body.startsWith('<!-- codex-meter:summary -->'));
    assert.ok(body.includes('src/a\\|b.ts'));
    assert.ok(body.includes('| critical |'));
    assert.ok(body.includes('Retries forever on 5xx.'));
    assert.ok(body.includes('_Fix:_ Cap attempts.'));
    assert.ok(body.includes('Budget: 120.0k / 1.00M tokens this month (12%)'));
    assert.ok(body.includes('head abc12345'));
});
test('large finding sets are truncated with a note', () => {
    const many = {
        ...review,
        findings: Array.from({ length: 25 }, (_, index) => ({
            severity: 'medium',
            file: `src/file-${index}.ts`,
            line: index + 1,
            title: `Issue ${index}`,
            detail: null,
            suggestion: null,
            confidence: null,
        })),
    };
    const body = renderReviewComment({
        review: many,
        spend,
        meta: { shortSha: 'abc12345', base: 'main', toolVersion: '0.1.0', durationMs: null, droppedFindings: 2 },
    });
    assert.ok(body.includes('2 malformed entries dropped'));
    assert.ok(body.includes('5 further findings were omitted'));
});
test('clean reviews say so instead of rendering an empty table', () => {
    const body = renderReviewComment({
        review: { summary: 'Looks fine.', risk: 'low', findings: [], skipReview: false },
        spend,
        meta: { shortSha: 'abc12345', base: 'main', toolVersion: '0.1.0', durationMs: null, droppedFindings: 0 },
    });
    assert.ok(body.includes('No material defects found.'));
    assert.ok(!body.includes('| severity |'));
});
test('skip comments explain the gate that stopped the run', () => {
    const body = renderSkipComment({
        title: 'Codex review skipped (budget-exhausted)',
        detail: 'Monthly token budget reached: 1,000,000 spent, limit 1,000,000.',
        meta: { shortSha: 'abc12345', base: 'main', toolVersion: '0.1.0' },
        spend,
    });
    assert.ok(body.startsWith('<!-- codex-meter:summary -->'));
    assert.ok(body.includes('budget-exhausted'));
    assert.ok(body.includes('Monthly token budget reached'));
});
test('report renders spend, severities and skips', () => {
    const record = {
        schema: 1,
        ts: '2026-09-16T10:00:00.000Z',
        repo: 'twoimo/codex-meter',
        pr: 3,
        sha: 'abcdef1234567890',
        base: 'main',
        decision: 'run',
        code: 'run',
        tier: 'review',
        model: 'gpt-5.4',
        usage: { inputTokens: 30_000, cachedInputTokens: 20_000, cacheWriteInputTokens: 0, outputTokens: 800, reasoningOutputTokens: 200 },
        estCostUsd: 0.03,
        durationMs: 60_000,
        findings: { critical: 0, high: 2, medium: 0, low: 0, info: 0 },
        toolVersion: '0.1.0',
        note: null,
    };
    const markdown = renderReportMarkdown(summarize([record], { month: '2026-09', repo: 'twoimo/codex-meter' }));
    assert.ok(markdown.includes('## codex-meter report — 2026-09 (twoimo/codex-meter)'));
    assert.ok(markdown.includes('Reviews: **1**'));
    assert.ok(markdown.includes('| high | 2 |'));
    assert.ok(markdown.includes('| #3 |'));
    assert.ok(markdown.includes('67%'));
});
test('the base ref is shown without the remote prefix', () => {
    assert.equal(displayBase('origin/main'), 'main');
    assert.equal(displayBase('main'), 'main');
    assert.equal(displayBase('origin/release/1.x'), 'release/1.x');
});
//# sourceMappingURL=render.test.js.map