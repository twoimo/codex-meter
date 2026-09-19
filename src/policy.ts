import type { Decision, DiffStats, Severity } from './types.js';
import type { BudgetState } from './types.js';
import type { MeterConfig } from './config.js';
import { priceFor, costUsd, type ModelPrice } from './pricing.js';

const DOCS_PATTERNS = [
  /\.(md|mdx|markdown|txt|rst|adoc)$/i,
  /^docs?\//i,
  /^licen[cs]e(\.|$)/i,
  /^changelog/i,
  /^contributing/i,
  /^code_of_conduct/i,
  /^\.github\/(ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE)/i,
];

const LOCK_PATTERNS = [
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/i,
  /(^|\/)(Cargo\.lock|poetry\.lock|Pipfile\.lock|uv\.lock|composer\.lock|Gemfile\.lock|go\.sum|packages\.lock\.json)$/i,
];

const GENERATED_PATTERNS = [
  /(^|\/)(dist|build|out|target|coverage|node_modules|vendor|third_party|__snapshots__)\//i,
  /\.(min\.js|min\.css|map|snap|pb\.go|g\.cs|designer\.cs)$/i,
  /_generated\.|\.generated\./i,
  /\.(png|jpe?g|gif|webp|avif|ico|pdf|woff2?|ttf|eot|mp4|mov|zip|gz|jar|wasm)$/i,
];

const TEST_PATTERNS = [
  /(^|\/)(tests?|__tests__|spec)\//i,
  /\.(test|spec)\.[cm]?[jt]sx?$/i,
  /_test\.(go|py|rs|rb)$/i,
];

export type FileKind = 'docs' | 'lock' | 'generated' | 'test' | 'ci' | 'source';

/** Automation accounts whose pull requests rarely need a paid review. */
const BOT_LOGINS = new Set([
  'dependabot',
  'renovate',
  'greenkeeper',
  'snyk-bot',
  'github-actions',
  'copilot-swe-agent',
]);

/**
 * Automation accounts are identified from GitHub's own convention (`[bot]`
 * suffix, `app/<slug>` identities) plus a short list of known accounts.
 *
 * A generic `-bot` suffix was removed on review: real people can own handles
 * like `some-bot`, and silently skipping a human contribution is worse than
 * reviewing one bot pull request.
 */
export function isBotAuthor(author: string | null | undefined): boolean {
  const name = (author ?? '').trim().toLowerCase();
  if (name.length === 0) return false;
  if (name.endsWith('[bot]')) return true;
  if (name.startsWith('app/') && name.length > 'app/'.length) return true;
  return BOT_LOGINS.has(name);
}

export function classifyPath(filePath: string): FileKind {
  const normalized = filePath.replace(/\\/g, '/');
  if (LOCK_PATTERNS.some((pattern) => pattern.test(normalized))) return 'lock';
  if (GENERATED_PATTERNS.some((pattern) => pattern.test(normalized))) return 'generated';
  if (DOCS_PATTERNS.some((pattern) => pattern.test(normalized))) return 'docs';
  if (/^\.github\/workflows\//i.test(normalized) || /^(Dockerfile|docker-compose.*)$/i.test(normalized)) return 'ci';
  if (TEST_PATTERNS.some((pattern) => pattern.test(normalized))) return 'test';
  return 'source';
}

export interface StatsBreakdown {
  byKind: Record<FileKind, number>;
  docsOnly: boolean;
  generatedOnly: boolean;
  testOnly: boolean;
  sourceFiles: number;
}

export function breakDown(stats: DiffStats): StatsBreakdown {
  const byKind: Record<FileKind, number> = { docs: 0, lock: 0, generated: 0, test: 0, ci: 0, source: 0 };
  for (const file of stats.files) {
    byKind[classifyPath(file.path)] += 1;
  }
  const meaningful = stats.files.length;
  return {
    byKind,
    docsOnly: meaningful > 0 && byKind.docs === meaningful,
    generatedOnly: meaningful > 0 && byKind.generated + byKind.lock === meaningful,
    testOnly: meaningful > 0 && byKind.test === meaningful,
    sourceFiles: byKind.source,
  };
}

export function estimateTokens(stats: DiffStats, config: MeterConfig): { input: number; output: number } {
  const { baselineTokens, tokensPerChangedLine, outputBaselineTokens, outputTokensPerChangedLine } = config.estimate;
  return {
    input: Math.round(baselineTokens + stats.changedLines * tokensPerChangedLine),
    output: Math.round(outputBaselineTokens + stats.changedLines * outputTokensPerChangedLine),
  };
}

export function estimateUsd(
  estimate: { input: number; output: number },
  model: string | null,
  pricing: Record<string, ModelPrice>,
): number | null {
  const match = priceFor(model, pricing);
  if (!match) return null;
  const cost = costUsd(
    {
      inputTokens: estimate.input,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: estimate.output,
      reasoningOutputTokens: 0,
    },
    match.price,
  );
  return cost.totalUsd;
}

export interface PullRequestMeta {
  number: number | null;
  title: string | null;
  draft: boolean;
  author: string | null;
  labels: string[];
  isFork: boolean;
}

export interface PolicyInput {
  config: MeterConfig;
  stats: DiffStats;
  budget: BudgetState;
  pull: PullRequestMeta | null;
  alreadyReviewed: boolean;
  hasCredential: boolean;
  now: string;
}

export interface PolicyOutcome {
  decision: Decision;
  estimate: { input: number; output: number; usd: number | null; priceApproximate: boolean };
  model: string | null;
}

function usd(value: number | null): string {
  return value === null ? 'unknown' : `$${value.toFixed(4)}`;
}

/**
 * Decide whether spending Codex tokens on this change is worth it. Rules are
 * evaluated cheapest-first and the first hit wins, so the decision is explainable.
 */
export function decide(input: PolicyInput): PolicyOutcome {
  const { config, stats, budget, pull } = input;
  const breakdown = breakDown(stats);
  const estimate = estimateTokens(stats, config);
  const model = config.model;
  const estimateCost = estimateUsd(estimate, model, config.pricing);
  const priceMatch = priceFor(model, config.pricing);
  const notes: string[] = [];

  const finish = (run: boolean, code: Decision['code'], detail: string): PolicyOutcome => ({
    decision: { run, code, detail, notes },
    estimate: { ...estimate, usd: estimateCost, priceApproximate: priceMatch?.approximate ?? false },
    model,
  });

  if (!config.enabled) return finish(false, 'disabled', 'codex-meter is disabled by configuration.');

  if (pull?.draft) return finish(false, 'draft', 'Pull request is a draft.');

  if (pull && config.skipBotAuthors && isBotAuthor(pull.author)) {
    return finish(false, 'bot-author', `Pull request author "${pull.author}" looks like automation.`);
  }

  if (pull && config.skipLabel && pull.labels.includes(config.skipLabel)) {
    return finish(false, 'label-skip', `Label "${config.skipLabel}" is present.`);
  }

  if (pull && config.requireLabel && !pull.labels.includes(config.requireLabel)) {
    return finish(
      false,
      'label-missing',
      `Opt-in mode: label "${config.requireLabel}" is required before a review is paid for.`,
    );
  }

  if (pull?.isFork && !config.allowForkPrs) {
    return finish(
      false,
      'fork-pr',
      'Pull request comes from a fork: secrets are not available and untrusted code must not spend your key. Set allowForkPrs to override.',
    );
  }

  if (stats.fileCount === 0) return finish(false, 'no-changes', 'No changed files found between base and head.');

  if (config.skipDocsOnly && breakdown.docsOnly) {
    return finish(false, 'docs-only', `Only documentation changed (${stats.fileCount} files).`);
  }

  if (config.skipGeneratedOnly && breakdown.generatedOnly) {
    return finish(
      false,
      'generated-only',
      `Only generated or lock files changed (${stats.fileCount} files: ${breakdown.byKind.generated} generated, ${breakdown.byKind.lock} lock).`,
    );
  }

  if (stats.changedLines < config.minChangedLines) {
    return finish(
      false,
      'too-small',
      `Diff has ${stats.changedLines} changed lines, below minChangedLines=${config.minChangedLines}.`,
    );
  }

  if (stats.changedLines > config.maxChangedLines) {
    return finish(
      false,
      'too-large',
      `Diff has ${stats.changedLines} changed lines, above maxChangedLines=${config.maxChangedLines}. Split the pull request or raise the limit.`,
    );
  }

  if (input.alreadyReviewed) {
    return finish(false, 'already-reviewed', 'This head commit already has a metered review in the ledger.');
  }

  if (!input.hasCredential) {
    return finish(false, 'no-credential', 'No Codex credential available (set CODEX_API_KEY or sign in to the Codex CLI).');
  }

  const monthTokens = budget.monthTokens + estimate.input + estimate.output;
  if (config.budget.tokensPerMonth !== null && monthTokens > config.budget.tokensPerMonth) {
    return finish(
      false,
      'budget-exhausted',
      `Monthly token budget reached: ${budget.monthTokens} spent, ~${estimate.input + estimate.output} estimated for this run, limit ${config.budget.tokensPerMonth}.`,
    );
  }

  if (config.budget.tokensPerRun !== null && estimate.input + estimate.output > config.budget.tokensPerRun) {
    return finish(
      false,
      'budget-exhausted',
      `Estimated run cost (~${estimate.input + estimate.output} tokens) exceeds tokensPerRun=${config.budget.tokensPerRun}.`,
    );
  }

  if (config.budget.usdPerMonth !== null) {
    if (estimateCost === null || budget.monthUsd === null) {
      notes.push('usdPerMonth is set but no price is known for this model; the dollar budget was not enforced.');
    } else if (budget.monthUsd + estimateCost > config.budget.usdPerMonth) {
      return finish(
        false,
        'budget-exhausted',
        `Monthly dollar budget reached: ${usd(budget.monthUsd)} spent, ~${usd(estimateCost)} estimated, limit ${usd(config.budget.usdPerMonth)}.`,
      );
    }
  }

  if (config.budget.usdPerRun !== null && estimateCost !== null && estimateCost > config.budget.usdPerRun) {
    return finish(
      false,
      'budget-exhausted',
      `Estimated run cost (~${usd(estimateCost)}) exceeds usdPerRun=${usd(config.budget.usdPerRun)}.`,
    );
  }

  if (priceMatch?.approximate) {
    notes.push(`No exact price entry for "${model}"; costs use the "${priceMatch.model}" rate.`);
  }

  return finish(true, 'run', `Estimated ~${estimate.input + estimate.output} tokens (${usd(estimateCost)}) for ${stats.changedLines} changed lines.`);
}

export function worstSeverity(counts: Record<Severity, number>): Severity | null {
  const order: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
  for (const severity of order) {
    if ((counts[severity] ?? 0) > 0) return severity;
  }
  return null;
}
