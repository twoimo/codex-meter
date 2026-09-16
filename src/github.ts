import { readFile } from 'node:fs/promises';
import type { PullRequestMeta } from './policy.js';
import { safeJsonParse } from './util.js';

export interface RepoContext {
  token: string;
  owner: string;
  repo: string;
  apiUrl: string;
}

export interface GitHubEnv {
  token: string | null;
  repository: string | null;
  eventPath: string | null;
  stepSummaryPath: string | null;
  outputPath: string | null;
  apiUrl: string;
  serverUrl: string;
}

export function githubEnvFromProcess(env: NodeJS.ProcessEnv = process.env): GitHubEnv {
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

export function repoContextFromEnv(env: GitHubEnv): RepoContext | null {
  if (!env.token || !env.repository) return null;
  const [owner, repo] = env.repository.split('/');
  if (!owner || !repo) return null;
  return { token: env.token, owner, repo, apiUrl: env.apiUrl };
}

export async function ghApi<T>(
  ctx: RepoContext,
  method: string,
  apiPath: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: T | null; text: string }> {
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
  const data = response.ok ? safeJsonParse<T>(text) : null;
  return { ok: response.ok, status: response.status, data, text };
}

export interface PullDetails extends PullRequestMeta {
  headSha: string | null;
  baseRef: string | null;
  htmlUrl: string | null;
}

/** Read PR metadata straight from the workflow event payload: no API call needed. */
export async function pullFromEvent(eventPath: string | null): Promise<PullDetails | null> {
  if (!eventPath) return null;
  try {
    const payload = safeJsonParse<Record<string, unknown>>(await readFile(eventPath, 'utf8'));
    const pull = payload?.['pull_request'] as Record<string, unknown> | undefined;
    if (!pull) return null;
    const head = pull['head'] as Record<string, unknown> | undefined;
    const base = pull['base'] as Record<string, unknown> | undefined;
    const headRepo = head?.['repo'] as Record<string, unknown> | null | undefined;
    const baseRepo = base?.['repo'] as Record<string, unknown> | null | undefined;
    const user = pull['user'] as Record<string, unknown> | undefined;
    const labels = Array.isArray(pull['labels'])
      ? (pull['labels'] as Record<string, unknown>[]).map((label) => String(label['name'] ?? '')).filter(Boolean)
      : [];
    const headFull = typeof headRepo?.['full_name'] === 'string' ? (headRepo['full_name'] as string) : null;
    const baseFull = typeof baseRepo?.['full_name'] === 'string' ? (baseRepo['full_name'] as string) : null;

    return {
      number: typeof pull['number'] === 'number' ? (pull['number'] as number) : null,
      title: typeof pull['title'] === 'string' ? (pull['title'] as string) : null,
      draft: pull['draft'] === true,
      author: typeof user?.['login'] === 'string' ? (user['login'] as string) : null,
      labels,
      isFork: headFull !== null && baseFull !== null ? headFull !== baseFull : false,
      headSha: typeof head?.['sha'] === 'string' ? (head['sha'] as string) : null,
      baseRef: typeof base?.['ref'] === 'string' ? (base['ref'] as string) : null,
      htmlUrl: typeof pull['html_url'] === 'string' ? (pull['html_url'] as string) : null,
    };
  } catch {
    return null;
  }
}

export async function fetchPull(ctx: RepoContext, prNumber: number): Promise<PullDetails | null> {
  const result = await ghApi<Record<string, unknown>>(ctx, 'GET', `/repos/${ctx.owner}/${ctx.repo}/pulls/${prNumber}`);
  if (!result.ok || !result.data) return null;
  const pull = result.data;
  const head = pull['head'] as Record<string, unknown> | undefined;
  const base = pull['base'] as Record<string, unknown> | undefined;
  const headRepo = head?.['repo'] as Record<string, unknown> | null | undefined;
  const baseRepo = base?.['repo'] as Record<string, unknown> | null | undefined;
  const user = pull['user'] as Record<string, unknown> | undefined;
  const headFull = typeof headRepo?.['full_name'] === 'string' ? (headRepo['full_name'] as string) : null;
  const baseFull = typeof baseRepo?.['full_name'] === 'string' ? (baseRepo['full_name'] as string) : null;
  const labels = Array.isArray(pull['labels'])
    ? (pull['labels'] as Record<string, unknown>[]).map((label) => String(label['name'] ?? '')).filter(Boolean)
    : [];
  return {
    number: typeof pull['number'] === 'number' ? (pull['number'] as number) : prNumber,
    title: typeof pull['title'] === 'string' ? (pull['title'] as string) : null,
    draft: pull['draft'] === true,
    author: typeof user?.['login'] === 'string' ? (user['login'] as string) : null,
    labels,
    isFork: headFull !== null && baseFull !== null ? headFull !== baseFull : false,
    headSha: typeof head?.['sha'] === 'string' ? (head['sha'] as string) : null,
    baseRef: typeof base?.['ref'] === 'string' ? (base['ref'] as string) : null,
    htmlUrl: typeof pull['html_url'] === 'string' ? (pull['html_url'] as string) : null,
  };
}

export const COMMENT_MARKER = '<!-- codex-meter:summary -->';

/**
 * Keep exactly one bot comment per pull request: find it by marker and patch it,
 * so repeated pushes do not spam reviewers.
 */
export async function upsertComment(
  ctx: RepoContext,
  prNumber: number,
  body: string,
): Promise<'created' | 'updated' | 'failed'> {
  const list = await ghApi<Record<string, unknown>[]>(
    ctx,
    'GET',
    `/repos/${ctx.owner}/${ctx.repo}/issues/${prNumber}/comments?per_page=100`,
  );
  if (!list.ok || !list.data) return 'failed';

  const existing = list.data.find((comment) => typeof comment['body'] === 'string' && (comment['body'] as string).includes(COMMENT_MARKER));
  if (existing && typeof existing['id'] === 'number') {
    const update = await ghApi(ctx, 'PATCH', `/repos/${ctx.owner}/${ctx.repo}/issues/comments/${existing['id']}`, { body });
    return update.ok ? 'updated' : 'failed';
  }

  const create = await ghApi(ctx, 'POST', `/repos/${ctx.owner}/${ctx.repo}/issues/${prNumber}/comments`, { body });
  return create.ok ? 'created' : 'failed';
}

export function appendStepSummary(text: string): void {
  const target = process.env['GITHUB_STEP_SUMMARY'];
  if (!target) return;
  void import('node:fs/promises').then(({ appendFile }) => appendFile(target, `${text}\n`, 'utf8'));
}

export function setOutput(name: string, value: string): void {
  const target = process.env['GITHUB_OUTPUT'];
  if (!target) return;
  const delimiter = `codex-meter-${Date.now()}`;
  const payload = `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
  void import('node:fs/promises').then(({ appendFile }) => appendFile(target, payload, 'utf8'));
}

interface ContentsRead {
  sha: string;
  content: string;
}

export class ContentsStore {
  constructor(
    private readonly ctx: RepoContext,
    private readonly branch: string,
    private readonly filePath: string,
    private readonly baseBranchHint: string | null = null,
  ) {}

  private apiPath(): string {
    return `/repos/${this.ctx.owner}/${this.ctx.repo}/contents/${this.filePath}`;
  }

  async read(): Promise<string | null> {
    const result = await ghApi<Record<string, unknown>>(
      this.ctx,
      'GET',
      `${this.apiPath()}?ref=${encodeURIComponent(this.branch)}`,
    );
    if (!result.ok || !result.data) return null;
    const content = result.data['content'];
    if (typeof content !== 'string') return null;
    return Buffer.from(content.replace(/\n/g, ''), 'base64').toString('utf8');
  }

  private async currentSha(): Promise<ContentsRead | null> {
    const result = await ghApi<Record<string, unknown>>(
      this.ctx,
      'GET',
      `${this.apiPath()}?ref=${encodeURIComponent(this.branch)}`,
    );
    if (!result.ok || !result.data) return null;
    const sha = result.data['sha'];
    const content = result.data['content'];
    if (typeof sha !== 'string' || typeof content !== 'string') return null;
    return { sha, content };
  }

  private async ensureBranch(): Promise<boolean> {
    const exists = await ghApi(this.ctx, 'GET', `/repos/${this.ctx.owner}/${this.ctx.repo}/git/ref/heads/${this.branch}`);
    if (exists.ok) return true;

    const repoInfo = await ghApi<Record<string, unknown>>(this.ctx, 'GET', `/repos/${this.ctx.owner}/${this.ctx.repo}`);
    const defaultBranch =
      (typeof repoInfo.data?.['default_branch'] === 'string' ? (repoInfo.data['default_branch'] as string) : null) ??
      this.baseBranchHint ??
      'main';
    const baseRef = await ghApi<Record<string, unknown>>(
      this.ctx,
      'GET',
      `/repos/${this.ctx.owner}/${this.ctx.repo}/git/ref/heads/${defaultBranch}`,
    );
    const sha = (baseRef.data?.['object'] as Record<string, unknown> | undefined)?.['sha'];
    if (typeof sha !== 'string') return false;
    const created = await ghApi(this.ctx, 'POST', `/repos/${this.ctx.owner}/${this.ctx.repo}/git/refs`, {
      ref: `refs/heads/${this.branch}`,
      sha,
    });
    return created.ok;
  }

  async write(content: string, message: string): Promise<boolean> {
    const existing = await this.currentSha();
    if (!existing) {
      const ready = await this.ensureBranch();
      if (!ready) return false;
    }
    const latest = existing ?? (await this.currentSha());
    const body: Record<string, unknown> = {
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: this.branch,
    };
    if (latest) body['sha'] = latest.sha;
    else if (!(await this.ensureBranch())) return false;

    const result = await ghApi(this.ctx, 'PUT', this.apiPath(), body);
    return result.ok;
  }
}
