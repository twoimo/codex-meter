import { readFile } from 'node:fs/promises';
import { safeJsonParse } from './util.js';
export function githubEnvFromProcess(env = process.env) {
    return {
        token: env['GITHUB_TOKEN'] ?? env['GH_TOKEN'] ?? null,
        repository: env['GITHUB_REPOSITORY'] ?? null,
        eventPath: env['GITHUB_EVENT_PATH'] ?? null,
        stepSummaryPath: env['GITHUB_STEP_SUMMARY'] ?? null,
        outputPath: env['GITHUB_OUTPUT'] ?? null,
        apiUrl: env['GITHUB_API_URL'] ?? 'https://api.github.com',
        serverUrl: env['GITHUB_SERVER_URL'] ?? 'https://github.com',
    };
}
export function repoContextFromEnv(env) {
    if (!env.token || !env.repository)
        return null;
    const [owner, repo] = env.repository.split('/');
    if (!owner || !repo)
        return null;
    return { token: env.token, owner, repo, apiUrl: env.apiUrl };
}
export async function ghApi(ctx, method, apiPath, body) {
    const response = await fetch(`${ctx.apiUrl}${apiPath}`, {
        method,
        headers: {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${ctx.token}`,
            'content-type': 'application/json',
            'user-agent': 'codex-meter',
            'x-github-api-version': '2022-11-28',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const data = response.ok ? safeJsonParse(text) : null;
    return { ok: response.ok, status: response.status, data, text };
}
/** Read PR metadata straight from the workflow event payload: no API call needed. */
export async function pullFromEvent(eventPath) {
    if (!eventPath)
        return null;
    try {
        const payload = safeJsonParse(await readFile(eventPath, 'utf8'));
        const pull = payload?.['pull_request'];
        if (!pull)
            return null;
        const head = pull['head'];
        const base = pull['base'];
        const headRepo = head?.['repo'];
        const baseRepo = base?.['repo'];
        const user = pull['user'];
        const labels = Array.isArray(pull['labels'])
            ? pull['labels'].map((label) => String(label['name'] ?? '')).filter(Boolean)
            : [];
        const headFull = typeof headRepo?.['full_name'] === 'string' ? headRepo['full_name'] : null;
        const baseFull = typeof baseRepo?.['full_name'] === 'string' ? baseRepo['full_name'] : null;
        return {
            number: typeof pull['number'] === 'number' ? pull['number'] : null,
            title: typeof pull['title'] === 'string' ? pull['title'] : null,
            draft: pull['draft'] === true,
            author: typeof user?.['login'] === 'string' ? user['login'] : null,
            labels,
            isFork: headFull !== null && baseFull !== null ? headFull !== baseFull : false,
            headSha: typeof head?.['sha'] === 'string' ? head['sha'] : null,
            baseRef: typeof base?.['ref'] === 'string' ? base['ref'] : null,
            htmlUrl: typeof pull['html_url'] === 'string' ? pull['html_url'] : null,
        };
    }
    catch {
        return null;
    }
}
export async function fetchPull(ctx, prNumber) {
    const result = await ghApi(ctx, 'GET', `/repos/${ctx.owner}/${ctx.repo}/pulls/${prNumber}`);
    if (!result.ok || !result.data)
        return null;
    const pull = result.data;
    const head = pull['head'];
    const base = pull['base'];
    const headRepo = head?.['repo'];
    const baseRepo = base?.['repo'];
    const user = pull['user'];
    const headFull = typeof headRepo?.['full_name'] === 'string' ? headRepo['full_name'] : null;
    const baseFull = typeof baseRepo?.['full_name'] === 'string' ? baseRepo['full_name'] : null;
    const labels = Array.isArray(pull['labels'])
        ? pull['labels'].map((label) => String(label['name'] ?? '')).filter(Boolean)
        : [];
    return {
        number: typeof pull['number'] === 'number' ? pull['number'] : prNumber,
        title: typeof pull['title'] === 'string' ? pull['title'] : null,
        draft: pull['draft'] === true,
        author: typeof user?.['login'] === 'string' ? user['login'] : null,
        labels,
        isFork: headFull !== null && baseFull !== null ? headFull !== baseFull : false,
        headSha: typeof head?.['sha'] === 'string' ? head['sha'] : null,
        baseRef: typeof base?.['ref'] === 'string' ? base['ref'] : null,
        htmlUrl: typeof pull['html_url'] === 'string' ? pull['html_url'] : null,
    };
}
export const COMMENT_MARKER = '<!-- codex-meter:summary -->';
/**
 * Keep exactly one bot comment per pull request: find it by marker and patch it,
 * so repeated pushes do not spam reviewers.
 */
export async function upsertComment(ctx, prNumber, body) {
    const list = await ghApi(ctx, 'GET', `/repos/${ctx.owner}/${ctx.repo}/issues/${prNumber}/comments?per_page=100`);
    if (!list.ok || !list.data)
        return 'failed';
    const existing = list.data.find((comment) => typeof comment['body'] === 'string' && comment['body'].includes(COMMENT_MARKER));
    if (existing && typeof existing['id'] === 'number') {
        const update = await ghApi(ctx, 'PATCH', `/repos/${ctx.owner}/${ctx.repo}/issues/comments/${existing['id']}`, { body });
        return update.ok ? 'updated' : 'failed';
    }
    const create = await ghApi(ctx, 'POST', `/repos/${ctx.owner}/${ctx.repo}/issues/${prNumber}/comments`, { body });
    return create.ok ? 'created' : 'failed';
}
export function appendStepSummary(text) {
    const target = process.env['GITHUB_STEP_SUMMARY'];
    if (!target)
        return;
    void import('node:fs/promises').then(({ appendFile }) => appendFile(target, `${text}\n`, 'utf8'));
}
export function setOutput(name, value) {
    const target = process.env['GITHUB_OUTPUT'];
    if (!target)
        return;
    const delimiter = `codex-meter-${Date.now()}`;
    const payload = `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
    void import('node:fs/promises').then(({ appendFile }) => appendFile(target, payload, 'utf8'));
}
export class ContentsStore {
    ctx;
    branch;
    filePath;
    baseBranchHint;
    constructor(ctx, branch, filePath, baseBranchHint = null) {
        this.ctx = ctx;
        this.branch = branch;
        this.filePath = filePath;
        this.baseBranchHint = baseBranchHint;
    }
    apiPath() {
        return `/repos/${this.ctx.owner}/${this.ctx.repo}/contents/${this.filePath}`;
    }
    async read() {
        const result = await ghApi(this.ctx, 'GET', `${this.apiPath()}?ref=${encodeURIComponent(this.branch)}`);
        if (!result.ok || !result.data)
            return null;
        const content = result.data['content'];
        if (typeof content !== 'string')
            return null;
        return Buffer.from(content.replace(/\n/g, ''), 'base64').toString('utf8');
    }
    async currentSha() {
        const result = await ghApi(this.ctx, 'GET', `${this.apiPath()}?ref=${encodeURIComponent(this.branch)}`);
        if (!result.ok || !result.data)
            return null;
        const sha = result.data['sha'];
        const content = result.data['content'];
        if (typeof sha !== 'string' || typeof content !== 'string')
            return null;
        return { sha, content };
    }
    async ensureBranch() {
        const exists = await ghApi(this.ctx, 'GET', `/repos/${this.ctx.owner}/${this.ctx.repo}/git/ref/heads/${this.branch}`);
        if (exists.ok)
            return true;
        const repoInfo = await ghApi(this.ctx, 'GET', `/repos/${this.ctx.owner}/${this.ctx.repo}`);
        const defaultBranch = (typeof repoInfo.data?.['default_branch'] === 'string' ? repoInfo.data['default_branch'] : null) ??
            this.baseBranchHint ??
            'main';
        const baseRef = await ghApi(this.ctx, 'GET', `/repos/${this.ctx.owner}/${this.ctx.repo}/git/ref/heads/${defaultBranch}`);
        const sha = baseRef.data?.['object']?.['sha'];
        if (typeof sha !== 'string')
            return false;
        const created = await ghApi(this.ctx, 'POST', `/repos/${this.ctx.owner}/${this.ctx.repo}/git/refs`, {
            ref: `refs/heads/${this.branch}`,
            sha,
        });
        return created.ok;
    }
    async write(content, message) {
        const existing = await this.currentSha();
        if (!existing) {
            const ready = await this.ensureBranch();
            if (!ready)
                return false;
        }
        const latest = existing ?? (await this.currentSha());
        const body = {
            message,
            content: Buffer.from(content, 'utf8').toString('base64'),
            branch: this.branch,
        };
        if (latest)
            body['sha'] = latest.sha;
        else if (!(await this.ensureBranch()))
            return false;
        const result = await ghApi(this.ctx, 'PUT', this.apiPath(), body);
        return result.ok;
    }
}
//# sourceMappingURL=github.js.map