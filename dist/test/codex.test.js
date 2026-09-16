import test from 'node:test';
import assert from 'node:assert/strict';
import { accumulateUsage, buildReviewPrompt, normalizeReview, normaliseFilePath, parseJsonl } from '../src/codex.js';
/** Captured from `codex exec --json --ephemeral -s read-only` (codex-cli 0.153.4). */
const CAPTURED = [
    '{"type":"thread.started","thread_id":"0199a213-81c0-7800-8aa1-bbab2a035a53"}',
    '{"type":"turn.started"}',
    'progress written to stderr',
    '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"PONG"}}',
    '{"type":"turn.completed","usage":{"input_tokens":18193,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":32,"reasoning_output_tokens":0}}',
].join('\n');
test('JSONL parsing keeps objects and skips human-readable progress', () => {
    const events = parseJsonl(CAPTURED);
    assert.equal(events.length, 4);
    assert.equal(events[0]?.['type'], 'thread.started');
});
test('usage is summed across turns, including cache and reasoning fields', () => {
    const events = parseJsonl([
        '{"type":"turn.completed","usage":{"input_tokens":1000,"cached_input_tokens":100,"cache_write_input_tokens":10,"output_tokens":50,"reasoning_output_tokens":5}}',
        '{"type":"turn.completed","usage":{"input_tokens":2000,"cached_input_tokens":200,"cache_write_input_tokens":20,"output_tokens":60,"reasoning_output_tokens":7}}',
    ].join('\n'));
    const { usage } = accumulateUsage(events);
    assert.equal(usage.inputTokens, 3000);
    assert.equal(usage.cachedInputTokens, 300);
    assert.equal(usage.cacheWriteInputTokens, 30);
    assert.equal(usage.outputTokens, 110);
    assert.equal(usage.reasoningOutputTokens, 12);
});
test('camelCase usage keys and model names are tolerated', () => {
    const events = parseJsonl('{"type":"turn.completed","model":"gpt-5.4","usage":{"inputTokens":10,"outputTokens":2}}');
    const { usage, model } = accumulateUsage(events);
    assert.equal(model, 'gpt-5.4');
    assert.equal(usage.inputTokens, 10);
    assert.equal(usage.outputTokens, 2);
});
test('review normalisation keeps valid findings and drops malformed ones', () => {
    const { review, dropped } = normalizeReview({
        summary: 'Adds a retry loop.',
        risk: 'high',
        skipReview: false,
        findings: [
            { severity: 'high', file: 'src/a.ts', line: 12, title: 'Unbounded retry', detail: 'Retries forever.', suggestion: 'Cap it.', confidence: 0.9 },
            { severity: 'nonsense', file: 'src/b.ts', title: 'Bad severity', detail: null, suggestion: null, confidence: null },
            { severity: 'low', file: '', title: 'No file', detail: null, suggestion: null, confidence: null },
            { severity: 'info', file: 'src/c.ts', line: -3, title: 'Line clamped', detail: null, suggestion: null, confidence: 4 },
        ],
    });
    assert.ok(review);
    assert.equal(dropped, 2);
    assert.equal(review.findings.length, 2);
    assert.equal(review.findings[0]?.line, 12);
    assert.equal(review.findings[1]?.line, null);
    assert.equal(review.findings[1]?.confidence, null);
    assert.equal(review.risk, 'high');
});
test('an unrecognised risk value falls back to medium', () => {
    const { review } = normalizeReview({ summary: '', risk: 'catastrophic', findings: [], skipReview: true });
    assert.ok(review);
    assert.equal(review.risk, 'medium');
    assert.equal(review.skipReview, true);
});
test('non-object payloads produce no review rather than an exception', () => {
    assert.equal(normalizeReview(null).review, null);
    assert.equal(normalizeReview('text').review, null);
});
test('the diff under review is always spelled out for the agent', () => {
    const appended = buildReviewPrompt('Review this change.', 'origin/main', 'abc1234');
    assert.ok(appended.includes('git diff origin/main...abc1234'));
    const templated = buildReviewPrompt('Diff {{base}} against {{head}}.', 'main', 'abc1234');
    assert.equal(templated, 'Diff main against abc1234.');
    assert.ok(!templated.includes('git diff'));
});
test('absolute finding paths are normalised to repository-relative ones', () => {
    assert.equal(normaliseFilePath('/repo/src/a.ts', '/repo'), 'src/a.ts');
    assert.equal(normaliseFilePath('./src/a.ts'), 'src/a.ts');
    assert.equal(normaliseFilePath('/elsewhere/src/a.ts', '/repo'), '/elsewhere/src/a.ts');
    const { review } = normalizeReview({
        summary: '',
        risk: 'low',
        skipReview: false,
        findings: [
            { severity: 'high', file: '/repo/src/a.ts', line: 3, title: 'Absolute path', detail: null, suggestion: null, confidence: null },
        ],
    }, '/repo');
    assert.equal(review?.findings[0]?.file, 'src/a.ts');
});
//# sourceMappingURL=codex.test.js.map