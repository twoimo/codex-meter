import { execFile } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
export const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'test', 'fixtures');
export function runCli(args, cwd, env = {}) {
    return new Promise((resolve) => {
        execFile(process.execPath, [CLI, ...args], {
            cwd,
            env: {
                ...process.env,
                CODEX_API_KEY: 'test-key',
                GITHUB_TOKEN: '',
                GITHUB_REPOSITORY: '',
                GITHUB_EVENT_PATH: '',
                GITHUB_STEP_SUMMARY: '',
                GITHUB_OUTPUT: '',
                ...env,
            },
        }, (error, stdout, stderr) => {
            const code = typeof error?.code === 'number' ? error.code : 0;
            resolve({ code, stdout, stderr });
        });
    });
}
export function git(cwd, args) {
    return new Promise((resolve, reject) => {
        execFile('git', args, { cwd }, (error) => (error ? reject(error) : resolve()));
    });
}
/** Build a repository with `main` plus a feature branch that differs from it. */
export async function fixtureRepo(files) {
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
/** Copy the fixtures (stub plus recorded session) somewhere writable and executable. */
export async function installCodexStub() {
    const dir = await mkdtemp(path.join(tmpdir(), 'codex-meter-stub-'));
    const target = path.join(dir, 'fixtures');
    await cp(FIXTURES, target, { recursive: true });
    const stub = path.join(target, 'codex-stub.mjs');
    await chmod(stub, 0o755);
    return stub;
}
//# sourceMappingURL=helpers.js.map