import { spawn } from 'node:child_process';
export function git(cwd, args) {
    return new Promise((resolve) => {
        const child = spawn('git', args, { cwd, env: process.env });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', (error) => resolve({ ok: false, stdout, stderr: `${stderr}${error.message}`, code: null }));
        child.on('close', (code) => resolve({ ok: code === 0, stdout, stderr, code }));
    });
}
export async function revParse(cwd, ref) {
    const result = await git(cwd, ['rev-parse', ref]);
    if (!result.ok)
        return null;
    return result.stdout.trim() || null;
}
export async function headSha(cwd) {
    return revParse(cwd, 'HEAD');
}
/**
 * Pick a base ref without assuming the default branch name: try the merge base
 * candidates the runner already has locally.
 */
export async function defaultBase(cwd) {
    const candidates = ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master'];
    for (const candidate of candidates) {
        const sha = await revParse(cwd, candidate);
        if (sha)
            return candidate;
    }
    return 'HEAD~1';
}
export async function mergeBase(cwd, base, head) {
    const result = await git(cwd, ['merge-base', base, head]);
    if (!result.ok)
        return null;
    return result.stdout.trim() || null;
}
const STATUS_MAP = {
    A: 'added',
    M: 'modified',
    D: 'deleted',
    R: 'renamed',
    C: 'modified',
    T: 'modified',
};
function parseNumstat(stdout) {
    const entries = [];
    for (const line of stdout.split('\n')) {
        if (!line.trim())
            continue;
        const parts = line.split('\t');
        if (parts.length < 3)
            continue;
        const [addedRaw, deletedRaw, ...pathParts] = parts;
        const rawPath = pathParts.join('\t');
        const binary = addedRaw === '-' || deletedRaw === '-';
        entries.push({
            added: binary ? 0 : Number(addedRaw) || 0,
            deleted: binary ? 0 : Number(deletedRaw) || 0,
            binary,
            path: rawPath.includes('=>') ? (rawPath.split('=>').pop() ?? rawPath).trim() : rawPath,
        });
    }
    return entries;
}
function parseNameStatus(stdout) {
    const map = new Map();
    for (const line of stdout.split('\n')) {
        if (!line.trim())
            continue;
        const parts = line.split('\t');
        const statusCode = (parts[0] ?? '').slice(0, 1);
        const rawPath = parts.length > 2 ? (parts[2] ?? '') : (parts[1] ?? '');
        if (!rawPath)
            continue;
        map.set(rawPath.trim(), STATUS_MAP[statusCode] ?? 'unknown');
    }
    return map;
}
/**
 * Diff stats for a pull request. Uses `base...head` so the comparison starts at
 * the merge base and does not include unrelated commits from the base branch.
 */
export async function diffStats(cwd, base, head) {
    const range = `${base}...${head}`;
    const numstat = await git(cwd, ['diff', '--numstat', '--find-renames', range]);
    const nameStatus = await git(cwd, ['diff', '--name-status', '--find-renames', range]);
    if (!numstat.ok) {
        return { files: [], fileCount: 0, added: 0, deleted: 0, changedLines: 0 };
    }
    const statuses = nameStatus.ok ? parseNameStatus(nameStatus.stdout) : new Map();
    const files = parseNumstat(numstat.stdout).map((entry) => ({
        path: entry.path,
        added: entry.added,
        deleted: entry.deleted,
        binary: entry.binary,
        status: statuses.get(entry.path) ?? 'unknown',
    }));
    const added = files.reduce((sum, file) => sum + file.added, 0);
    const deleted = files.reduce((sum, file) => sum + file.deleted, 0);
    return { files, fileCount: files.length, added, deleted, changedLines: added + deleted };
}
//# sourceMappingURL=git.js.map