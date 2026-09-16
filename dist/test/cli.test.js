import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
function run(args, cwd) {
    return new Promise((resolve) => {
        execFile(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, CODEX_API_KEY: 'test-key', GITHUB_TOKEN: '', GITHUB_REPOSITORY: '', GITHUB_EVENT_PATH: '' } }, (error, stdout, stderr) => {
            const code = typeof error?.code === 'number' ? (error.code) : 0;
            resolve({ code, stdout, stderr });
        });
    });
}
async function git(cwd, args) {
    await new Promise((resolve, reject) => {
        execFile('git', args, { cwd }, (error) => (error ? reject(error) : resolve()));
    });
}
/** Build a repository with `main` plus a feature branch that differs. */
async function fixtureRepo(files) {
    const dir = await mkdtemp(path.join(tmpdir(), 'codex-meter-test-'));
    await git(dir, ['init', '-q', '-b', 'main']);
    await git(dir, ['config', 'user.email', 'test@example.com']);
    await git(dir, ['config', 'user.name', 'Test']);
    await git(dir, ['config', 'commit.gpgsign', 'false']);
    await writeFile(path.join(dir, 'src-app.ts'), 'export const value = 1;\n', 'utf8');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-qm', 'init']);
    await git(dir, ['checkout', '-q', '-b', 'feature']);
    for (const [name, content] of files) {
        const target = path.join(dir, name);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content, 'utf8');
    }
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-qm', 'change']);
    return dir;
}
test('explain approves a source change and reports the estimate', async () => {
    const dir = await fixtureRepo([['src/feature.ts', `${Array.from({ length: 30 }, (_, i) => `export const v${i} = ${i};`).join('\n')}\n`]]);
    const result = await run(['explain', '--cwd', dir], dir);
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.decision.run, true);
    assert.equal(payload.decision.code, 'run');
    assert.equal(payload.credential, 'api-key');
    assert.ok(payload.estimate.input > 18_000);
    assert.equal(payload.budget.tokensPerMonth, 1_200_000);
});
test('explain skips documentation-only changes', async () => {
    const dir = await fixtureRepo([['docs/notes.md', '# notes\n\nSome documentation.\n']]);
    const result = await run(['explain', '--cwd', dir], dir);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.decision.run, false);
    assert.equal(payload.decision.code, 'docs-only');
});
test('an exhausted monthly budget stops the run before any spending', async () => {
    const dir = await fixtureRepo([['src/feature.ts', 'export const added = true;\n']]);
    const result = await run(['explain', '--cwd', dir, '--budget-tokens', '0'], dir);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.decision.code, 'budget-exhausted');
});
test('report summarises an existing ledger', async () => {
    const dir = await fixtureRepo([['src/feature.ts', 'export const added = true;\n']]);
    const ledgerPath = path.join(dir, 'ledger.jsonl');
    await writeFile(ledgerPath, `${JSON.stringify({
        schema: 1,
        ts: '2026-09-16T10:00:00.000Z',
        repo: null,
        pr: 5,
        sha: 'abcdef1234567890',
        base: 'main',
        decision: 'run',
        code: 'run',
        tier: 'review',
        model: 'gpt-5.4',
        usage: { inputTokens: 20_000, cachedInputTokens: 10_000, cacheWriteInputTokens: 0, outputTokens: 400, reasoningOutputTokens: 100 },
        estCostUsd: 0.02,
        durationMs: 30_000,
        findings: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
        toolVersion: '0.1.0',
        note: null,
    })}\n`, 'utf8');
    const result = await run(['report', '--cwd', dir, '--ledger', ledgerPath, '--month', '2026-09'], dir);
    assert.equal(result.code, 0);
    assert.ok(result.stdout.includes('## codex-meter report — 2026-09'));
    assert.ok(result.stdout.includes('Reviews: **1**'));
    assert.ok(result.stdout.includes('| #5 |'));
});
test('unknown commands exit with a usage error', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'codex-meter-test-'));
    const result = await run(['frobnicate'], dir);
    assert.equal(result.code, 2);
    assert.ok(result.stderr.includes('unknown command'));
});
//# sourceMappingURL=cli.test.js.map