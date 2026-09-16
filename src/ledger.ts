import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { LedgerRecord, Severity } from './types.js';
import { monthKey, safeJsonParse } from './util.js';

export interface LedgerStore {
  read(): Promise<LedgerRecord[]>;
  append(record: LedgerRecord): Promise<void>;
  describe(): string;
}

function isRecord(value: unknown): value is LedgerRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate['schema'] === 1 && typeof candidate['ts'] === 'string' && typeof candidate['code'] === 'string';
}

export function parseLedger(text: string): LedgerRecord[] {
  const records: LedgerRecord[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    const parsed = safeJsonParse<unknown>(trimmed);
    if (isRecord(parsed)) records.push(parsed);
  }
  return records;
}

export function serializeRecord(record: LedgerRecord): string {
  return `${JSON.stringify(record)}\n`;
}

export function createFileStore(filePath: string, baseDir?: string): LedgerStore {
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(baseDir ?? process.cwd(), filePath);
  return {
    describe: () => `file:${absolute}`,
    async read() {
      try {
        return parseLedger(await readFile(absolute, 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    },
    async append(record) {
      await mkdir(path.dirname(absolute), { recursive: true });
      await appendFile(absolute, serializeRecord(record), 'utf8');
    },
  };
}

export function createMemoryStore(seed: LedgerRecord[] = []): LedgerStore {
  const records = [...seed];
  return {
    describe: () => 'memory',
    async read() {
      return [...records];
    },
    async append(record) {
      records.push(record);
    },
  };
}

export interface LedgerTotals {
  tokens: number;
  usd: number;
  usdComplete: boolean;
  runs: number;
  skipped: number;
}

export interface LedgerSummary {
  generatedAt: string;
  month: string;
  repo: string | null;
  totals: LedgerTotals;
  skipReasons: { code: string; count: number }[];
  severities: Record<Severity, number>;
  reviewsWithFindings: number;
  averageTokensPerReview: number;
  averageUsdPerReview: number | null;
  cacheHitRatio: number | null;
  topSpend: { pr: number | null; sha: string | null; tokens: number; usd: number | null; ts: string }[];
}

export function monthTotals(
  records: LedgerRecord[],
  options: { month: string; repo?: string | null },
): LedgerTotals {
  let tokens = 0;
  let usd = 0;
  let usdComplete = true;
  let runs = 0;
  let skipped = 0;

  for (const record of records) {
    if (monthKey(record.ts) !== options.month) continue;
    if (options.repo && record.repo && record.repo !== options.repo) continue;
    if (record.decision === 'run') {
      runs += 1;
      tokens += record.usage.inputTokens + record.usage.outputTokens + record.usage.reasoningOutputTokens;
      if (record.estCostUsd === null) usdComplete = false;
      else usd += record.estCostUsd;
    } else {
      skipped += 1;
    }
  }

  return { tokens, usd: Math.round(usd * 1e6) / 1e6, usdComplete, runs, skipped };
}

export function wasReviewed(
  records: LedgerRecord[],
  target: { repo: string | null; pr: number | null; sha: string | null },
): boolean {
  if (!target.sha) return false;
  return records.some(
    (record) =>
      record.decision === 'run' &&
      record.sha === target.sha &&
      (target.pr === null || record.pr === target.pr) &&
      (target.repo === null || record.repo === target.repo),
  );
}

export function summarize(
  records: LedgerRecord[],
  options: { month: string; repo?: string | null },
): LedgerSummary {
  const scoped = records.filter(
    (record) => monthKey(record.ts) === options.month && (!options.repo || !record.repo || record.repo === options.repo),
  );

  const totals = monthTotals(scoped, options);
  const skipCounts = new Map<string, number>();
  const severities: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  let reviewsWithFindings = 0;
  let cachedInput = 0;
  let input = 0;

  for (const record of scoped) {
    if (record.decision !== 'run') {
      skipCounts.set(record.code, (skipCounts.get(record.code) ?? 0) + 1);
      continue;
    }
    cachedInput += record.usage.cachedInputTokens;
    input += record.usage.inputTokens;
    let hasFinding = false;
    for (const severity of Object.keys(severities) as Severity[]) {
      const count = record.findings[severity] ?? 0;
      severities[severity] += count;
      if (count > 0) hasFinding = true;
    }
    if (hasFinding) reviewsWithFindings += 1;
  }

  const runs = scoped.filter((record) => record.decision === 'run');
  const topSpend = [...runs]
    .sort(
      (a, b) =>
        b.usage.inputTokens + b.usage.outputTokens - (a.usage.inputTokens + a.usage.outputTokens),
    )
    .slice(0, 5)
    .map((record) => ({
      pr: record.pr,
      sha: record.sha,
      tokens: record.usage.inputTokens + record.usage.outputTokens + record.usage.reasoningOutputTokens,
      usd: record.estCostUsd,
      ts: record.ts,
    }));

  return {
    generatedAt: new Date().toISOString(),
    month: options.month,
    repo: options.repo ?? null,
    totals,
    skipReasons: [...skipCounts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count),
    severities,
    reviewsWithFindings,
    averageTokensPerReview: runs.length > 0 ? Math.round(totals.tokens / runs.length) : 0,
    averageUsdPerReview: runs.length > 0 && totals.usdComplete ? Math.round((totals.usd / runs.length) * 1e6) / 1e6 : null,
    cacheHitRatio: input > 0 ? Math.round((cachedInput / input) * 1000) / 1000 : null,
    topSpend,
  };
}
