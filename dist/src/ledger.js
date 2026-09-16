import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { monthKey, safeJsonParse } from './util.js';
function isRecord(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const candidate = value;
    return candidate['schema'] === 1 && typeof candidate['ts'] === 'string' && typeof candidate['code'] === 'string';
}
export function parseLedger(text) {
    const records = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{'))
            continue;
        const parsed = safeJsonParse(trimmed);
        if (isRecord(parsed))
            records.push(parsed);
    }
    return records;
}
export function serializeRecord(record) {
    return `${JSON.stringify(record)}\n`;
}
export function createFileStore(filePath, baseDir) {
    const absolute = path.isAbsolute(filePath) ? filePath : path.join(baseDir ?? process.cwd(), filePath);
    return {
        describe: () => `file:${absolute}`,
        async read() {
            try {
                return parseLedger(await readFile(absolute, 'utf8'));
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    return [];
                throw error;
            }
        },
        async append(record) {
            await mkdir(path.dirname(absolute), { recursive: true });
            await appendFile(absolute, serializeRecord(record), 'utf8');
        },
    };
}
export function createMemoryStore(seed = []) {
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
export function monthTotals(records, options) {
    let tokens = 0;
    let usd = 0;
    let usdComplete = true;
    let runs = 0;
    let skipped = 0;
    for (const record of records) {
        if (monthKey(record.ts) !== options.month)
            continue;
        if (options.repo && record.repo && record.repo !== options.repo)
            continue;
        if (record.decision === 'run') {
            runs += 1;
            tokens += record.usage.inputTokens + record.usage.outputTokens + record.usage.reasoningOutputTokens;
            if (record.estCostUsd === null)
                usdComplete = false;
            else
                usd += record.estCostUsd;
        }
        else {
            skipped += 1;
        }
    }
    return { tokens, usd: Math.round(usd * 1e6) / 1e6, usdComplete, runs, skipped };
}
export function wasReviewed(records, target) {
    if (!target.sha)
        return false;
    return records.some((record) => record.decision === 'run' &&
        record.sha === target.sha &&
        (target.pr === null || record.pr === target.pr) &&
        (target.repo === null || record.repo === target.repo));
}
export function summarize(records, options) {
    const scoped = records.filter((record) => monthKey(record.ts) === options.month && (!options.repo || !record.repo || record.repo === options.repo));
    const totals = monthTotals(scoped, options);
    const skipCounts = new Map();
    const severities = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
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
        for (const severity of Object.keys(severities)) {
            const count = record.findings[severity] ?? 0;
            severities[severity] += count;
            if (count > 0)
                hasFinding = true;
        }
        if (hasFinding)
            reviewsWithFindings += 1;
    }
    const runs = scoped.filter((record) => record.decision === 'run');
    const topSpend = [...runs]
        .sort((a, b) => b.usage.inputTokens + b.usage.outputTokens - (a.usage.inputTokens + a.usage.outputTokens))
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
//# sourceMappingURL=ledger.js.map