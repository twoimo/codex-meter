#!/usr/bin/env node
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createThrowawayCodexHome, hasStoredAuth, loginWithApiKey, removeCodexHome, resolveCodexHome, runCodexReview, } from './codex.js';
import { loadConfig } from './config.js';
import { defaultBase, diffStats, headSha, revParse } from './git.js';
import { appendStepSummary, ContentsStore, fetchPull, githubEnvFromProcess, pullFromEvent, repoContextFromEnv, setOutput, upsertComment, } from './github.js';
import { createFileStore, monthTotals, parseLedger, serializeRecord, summarize, wasReviewed, } from './ledger.js';
import { decide, worstSeverity } from './policy.js';
import { priceFor, costUsd, roundUsd } from './pricing.js';
import { resolvePrompt } from './prompt.js';
import { renderErrorComment, renderReportMarkdown, renderReviewComment, renderSkipComment } from './render.js';
import { EMPTY_USAGE, SEVERITY_RANK } from './types.js';
import { formatTokens, formatUsd, isoNow, monthKey, truncate } from './util.js';
import { TOOL_VERSION } from './version.js';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(HERE, '..', '..', 'schemas', 'findings.schema.json');
const SKIP_CODES_WORTH_COMMENTING = new Set(['budget-exhausted', 'too-large', 'fork-pr']);
function log(message) {
    process.stderr.write(`${message}\n`);
}
function shortSha(sha) {
    return sha ? sha.slice(0, 8) : 'unknown';
}
function numberOption(options, key) {
    const raw = options[key];
    if (raw === undefined)
        return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}
function stringOption(options, key) {
    const raw = options[key];
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
}
async function resolveBase(cwd, requested, pull) {
    if (requested)
        return requested;
    if (pull?.baseRef) {
        const remote = await revParse(cwd, `origin/${pull.baseRef}`);
        if (remote)
            return `origin/${pull.baseRef}`;
        const local = await revParse(cwd, pull.baseRef);
        if (local)
            return pull.baseRef;
    }
    return defaultBase(cwd);
}
function clientConfigWithOverrides(config, options) {
    const next = structuredClone(config);
    const model = stringOption(options, 'model');
    if (model)
        next.model = model;
    const codexBin = stringOption(options, 'codexBin');
    if (codexBin)
        next.codexBin = codexBin;
    const promptFile = stringOption(options, 'promptFile');
    if (promptFile)
        next.promptFile = promptFile;
    const timeoutMs = numberOption(options, 'timeoutMs');
    if (timeoutMs !== null)
        next.timeoutMs = timeoutMs;
    const budgetTokens = numberOption(options, 'budgetTokens');
    if (budgetTokens !== null)
        next.budget.tokensPerMonth = budgetTokens;
    const budgetUsd = numberOption(options, 'budgetUsd');
    if (budgetUsd !== null)
        next.budget.usdPerMonth = budgetUsd;
    const runTokens = numberOption(options, 'runTokens');
    if (runTokens !== null)
        next.budget.tokensPerRun = runTokens;
    const maxChangedLines = numberOption(options, 'maxChangedLines');
    if (maxChangedLines !== null)
        next.maxChangedLines = maxChangedLines;
    const minChangedLines = numberOption(options, 'minChangedLines');
    if (minChangedLines !== null)
        next.minChangedLines = minChangedLines;
    const state = stringOption(options, 'state');
    if (state === 'file' || state === 'branch')
        next.state.mode = state;
    const ledger = stringOption(options, 'ledger');
    if (ledger) {
        next.state.mode = 'file';
        next.state.path = ledger;
    }
    const comment = stringOption(options, 'comment');
    if (comment === 'upsert' || comment === 'off')
        next.comment = comment;
    if (options['noComment'] === true)
        next.comment = 'off';
    const failOn = stringOption(options, 'failOn');
    if (failOn === 'never' || (failOn !== null && ['critical', 'high', 'medium', 'low', 'info'].includes(failOn))) {
        next.failOn = failOn;
    }
    if (options['allowForkPrs'] === true)
        next.allowForkPrs = true;
    if (options['dryRun'] === true)
        next.dryRun = true;
    if (options['respectUserConfig'] === true)
        next.ignoreUserConfig = false;
    return next;
}
function createBranchStore(ctx, branch, filePath, baseHint) {
    const contents = new ContentsStore(ctx, branch, filePath, baseHint);
    return {
        describe: () => `branch:${ctx.owner}/${ctx.repo}@${branch}:${filePath}`,
        async read() {
            const text = await contents.read();
            return text ? parseLedger(text) : [];
        },
        async append(record) {
            const existing = (await contents.read()) ?? '';
            const next = `${existing}${existing.endsWith('\n') || existing.length === 0 ? '' : '\n'}${serializeRecord(record)}`;
            await contents.write(next, `codex-meter: record ${record.code} ${record.sha ? record.sha.slice(0, 8) : ''}`.trim());
        },
    };
}
function emptyFindings() {
    return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}
function countFindings(usageFindings) {
    const counts = emptyFindings();
    for (const finding of usageFindings)
        counts[finding.severity] += 1;
    return counts;
}
async function commandReview(options) {
    const cwd = stringOption(options, 'cwd') ?? process.cwd();
    const configPath = stringOption(options, 'config');
    const { config: loadedConfig, unknownKeys, source } = await loadConfig(cwd, configPath);
    const config = clientConfigWithOverrides(loadedConfig, options);
    if (unknownKeys.length > 0)
        log(`warning: unknown config keys ignored: ${unknownKeys.join(', ')}`);
    const env = githubEnvFromProcess();
    const ctx = repoContextFromEnv(env);
    let pull = await pullFromEvent(env.eventPath);
    const explicitPr = numberOption(options, 'pr');
    if (!pull && ctx && explicitPr !== null)
        pull = await fetchPull(ctx, explicitPr);
    if (!pull && ctx && env.eventPath)
        log('warning: no pull_request payload found in the event; continuing without PR metadata');
    const base = await resolveBase(cwd, stringOption(options, 'base'), pull);
    const head = stringOption(options, 'head') ?? pull?.headSha ?? (await headSha(cwd)) ?? '';
    const repoSlug = ctx ? `${ctx.owner}/${ctx.repo}` : null;
    const stats = await diffStats(cwd, base, head);
    const store = config.state.mode === 'branch' && ctx
        ? createBranchStore(ctx, config.state.branch, config.state.path, pull?.baseRef ?? null)
        : createFileStore(config.state.path, cwd);
    let records = [];
    try {
        records = await store.read();
    }
    catch (error) {
        log(`warning: could not read ledger (${store.describe()}): ${error.message}`);
        records = [];
    }
    const month = monthKey(isoNow());
    const totals = monthTotals(records, { month, repo: repoSlug });
    const alreadyReviewed = wasReviewed(records, { repo: repoSlug, pr: pull?.number ?? explicitPr, sha: head });
    const apiKey = stringOption(options, 'apiKey') ?? process.env['CODEX_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? null;
    const existingHome = resolveCodexHome(null);
    const hasCredential = Boolean(apiKey) || hasStoredAuth(existingHome);
    const prMeta = pull
        ? {
            number: pull.number,
            title: pull.title,
            draft: pull.draft,
            author: pull.author,
            labels: pull.labels,
            isFork: pull.isFork,
        }
        : null;
    const outcome = decide({
        config,
        stats,
        budget: { monthTokens: totals.tokens, monthUsd: totals.usdComplete ? totals.usd : null, runTokens: 0, runUsd: 0 },
        pull: prMeta,
        alreadyReviewed,
        hasCredential,
        now: isoNow(),
    });
    const meta = {
        shortSha: shortSha(head),
        base,
        toolVersion: TOOL_VERSION,
        durationMs: null,
    };
    const spendLine = (usage, cost, model) => ({
        usage,
        costUsd: cost,
        model,
        monthTokens: totals.tokens,
        monthTokenBudget: config.budget.tokensPerMonth,
        monthUsd: totals.usdComplete ? totals.usd : null,
        monthUsdBudget: config.budget.usdPerMonth,
    });
    const emit = (payload) => {
        if (options['json'] === true)
            process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    };
    log(`codex-meter ${TOOL_VERSION}: ${outcome.decision.code} — ${outcome.decision.detail}`);
    log(`diff: ${stats.fileCount} files, ${stats.changedLines} changed lines (base ${base})`);
    log(`ledger: ${store.describe()}`);
    for (const note of outcome.decision.notes)
        log(`note: ${note}`);
    if (!outcome.decision.run || config.dryRun) {
        if (config.dryRun)
            log('dry run: no Codex run, no comment, no ledger write');
        if (outcome.decision.run === false && SKIP_CODES_WORTH_COMMENTING.has(outcome.decision.code) && ctx && pull?.number && config.comment === 'upsert' && !config.dryRun) {
            await upsertComment(ctx, pull.number, renderSkipComment({
                title: `Codex review skipped (${outcome.decision.code})`,
                detail: outcome.decision.detail,
                meta: { ...meta },
                spend: spendLine(EMPTY_USAGE, null, outcome.model),
            }));
        }
        if (!config.dryRun && outcome.decision.run === false) {
            const record = {
                schema: 1,
                ts: isoNow(),
                repo: repoSlug,
                pr: pull?.number ?? explicitPr,
                sha: head,
                base,
                decision: outcome.decision.code === 'budget-exhausted' ? 'budget-stop' : 'skip',
                code: outcome.decision.code,
                tier: 'none',
                model: outcome.model,
                usage: { ...EMPTY_USAGE },
                estCostUsd: null,
                durationMs: null,
                findings: emptyFindings(),
                toolVersion: TOOL_VERSION,
                note: truncate(outcome.decision.detail, 200),
            };
            try {
                await store.append(record);
            }
            catch (error) {
                log(`warning: could not write ledger: ${error.message}`);
            }
        }
        setOutput('decision', outcome.decision.code);
        setOutput('spend-tokens', '0');
        emit({ decision: outcome.decision, estimate: outcome.estimate, stats: { files: stats.fileCount, changedLines: stats.changedLines }, ledger: store.describe() });
        return 0;
    }
    const prompt = await resolvePrompt(config.promptFile, cwd);
    let codexHome = existingHome;
    let throwaway = null;
    if (apiKey) {
        throwaway = await createThrowawayCodexHome();
        codexHome = throwaway;
        const login = await loginWithApiKey(config.codexBin, apiKey, codexHome);
        if (!login.ok) {
            log(`error: ${login.message}`);
            if (throwaway)
                await removeCodexHome(throwaway);
            emit({ decision: { run: false, code: 'no-credential', detail: login.message } });
            setOutput('decision', 'no-credential');
            return 0;
        }
    }
    const outputFile = path.join(tmpdir(), `codex-meter-${head.slice(0, 12)}-${Date.now()}.json`);
    log(`running Codex review (model ${outcome.model ?? 'cli-default'}, timeout ${Math.round(config.timeoutMs / 1000)}s)`);
    const result = await runCodexReview({
        bin: config.codexBin,
        cwd,
        base,
        head,
        prompt,
        model: outcome.model,
        codexArgs: config.codexArgs,
        timeoutMs: config.timeoutMs,
        ignoreUserConfig: config.ignoreUserConfig,
        codexHome,
        schemaPath: SCHEMA_PATH,
        outputFile,
    });
    if (throwaway)
        await removeCodexHome(throwaway);
    const match = priceFor(result.model ?? outcome.model, config.pricing);
    const cost = match ? roundUsd(costUsd(result.usage, match.price).totalUsd) : null;
    const usageTotals = {
        tokens: result.usage.inputTokens + result.usage.outputTokens + result.usage.reasoningOutputTokens,
    };
    log(`codex finished in ${Math.round(result.durationMs / 1000)}s: ${result.errorKind}, ${formatTokens(usageTotals.tokens)} tokens, ${formatUsd(cost)}`);
    if (result.errorKind !== 'none' && result.failureReason)
        log(`codex failure: ${result.failureReason}`);
    const findings = result.review?.findings ?? [];
    const counts = countFindings(findings);
    const worst = worstSeverity(counts);
    const record = {
        schema: 1,
        ts: isoNow(),
        repo: repoSlug,
        pr: pull?.number ?? explicitPr,
        sha: head,
        base,
        decision: result.errorKind === 'none' ? 'run' : 'error',
        code: result.errorKind === 'none' ? 'run' : 'error',
        tier: 'review',
        model: result.model ?? outcome.model,
        usage: result.usage,
        estCostUsd: cost,
        durationMs: result.durationMs,
        findings: counts,
        toolVersion: TOOL_VERSION,
        note: result.errorKind === 'none'
            ? null
            : truncate(result.failureReason ?? result.errorKind, 200),
    };
    try {
        await store.append(record);
    }
    catch (error) {
        log(`warning: could not write ledger: ${error.message}`);
    }
    if (ctx && pull?.number && config.comment === 'upsert') {
        if (result.errorKind === 'none' && result.review) {
            await upsertComment(ctx, pull.number, renderReviewComment({
                review: result.review,
                spend: spendLine(result.usage, cost, result.model ?? outcome.model),
                meta: { ...meta, durationMs: result.durationMs, droppedFindings: 0 },
            }));
        }
        else {
            await upsertComment(ctx, pull.number, renderErrorComment({
                detail: result.failureReason ?? result.errorKind,
                stderrTail: result.stderrTail,
                spend: spendLine(result.usage, cost, result.model ?? outcome.model),
                meta: { ...meta, durationMs: result.durationMs },
            }));
        }
    }
    setOutput('decision', 'run');
    setOutput('spend-tokens', String(usageTotals.tokens));
    setOutput('spend-usd', cost === null ? '' : cost.toFixed(6));
    setOutput('findings', String(findings.length));
    const summaryLine = [
        `codex-meter: ${findings.length} findings`,
        worst ? `(worst ${worst})` : '',
        `· ${formatTokens(usageTotals.tokens)} tokens · ${formatUsd(cost)}`,
        `· head ${meta.shortSha} · ${result.errorKind === 'none' ? 'ok' : result.errorKind}`,
    ]
        .filter(Boolean)
        .join(' ');
    appendStepSummary(`### ${summaryLine}`);
    emit({
        decision: outcome.decision,
        estimate: outcome.estimate,
        result: {
            errorKind: result.errorKind,
            failureReason: result.failureReason,
            durationMs: result.durationMs,
            usage: result.usage,
            model: result.model ?? outcome.model,
            costUsd: cost,
            findings: counts,
            summary: result.review?.summary ?? null,
        },
    });
    if (result.errorKind !== 'none')
        return 0;
    if (config.failOn === 'never')
        return 0;
    const threshold = SEVERITY_RANK[config.failOn];
    const actual = worst ? SEVERITY_RANK[worst] : -1;
    return actual >= threshold ? 1 : 0;
}
async function commandExplain(options) {
    const cwd = stringOption(options, 'cwd') ?? process.cwd();
    const { config: loaded, unknownKeys, source } = await loadConfig(cwd, stringOption(options, 'config'));
    const config = clientConfigWithOverrides(loaded, options);
    const env = githubEnvFromProcess();
    const ctx = repoContextFromEnv(env);
    const pull = (await pullFromEvent(env.eventPath)) ?? null;
    const base = await resolveBase(cwd, stringOption(options, 'base'), pull);
    const head = stringOption(options, 'head') ?? pull?.headSha ?? (await headSha(cwd)) ?? '';
    const repoSlug = ctx ? `${ctx.owner}/${ctx.repo}` : null;
    const stats = await diffStats(cwd, base, head);
    const store = config.state.mode === 'branch' && ctx
        ? createBranchStore(ctx, config.state.branch, config.state.path, pull?.baseRef ?? null)
        : createFileStore(config.state.path, cwd);
    let records = [];
    try {
        records = await store.read();
    }
    catch {
        records = [];
    }
    const month = monthKey(isoNow());
    const totals = monthTotals(records, { month, repo: repoSlug });
    const apiKey = stringOption(options, 'apiKey') ?? process.env['CODEX_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? null;
    const existingHome = resolveCodexHome(null);
    const outcome = decide({
        config,
        stats,
        budget: { monthTokens: totals.tokens, monthUsd: totals.usdComplete ? totals.usd : null, runTokens: 0, runUsd: 0 },
        pull: pull
            ? { number: pull.number, title: pull.title, draft: pull.draft, author: pull.author, labels: pull.labels, isFork: pull.isFork }
            : null,
        alreadyReviewed: wasReviewed(records, { repo: repoSlug, pr: pull?.number ?? null, sha: head }),
        hasCredential: Boolean(apiKey) || hasStoredAuth(existingHome),
        now: isoNow(),
    });
    const payload = {
        decision: outcome.decision,
        estimate: outcome.estimate,
        model: outcome.model,
        base,
        head,
        stats: {
            files: stats.fileCount,
            changedLines: stats.changedLines,
            byKind: stats.files.reduce((acc, file) => {
                const kind = file.path;
                acc[kind] = (acc[kind] ?? 0) + 1;
                return acc;
            }, {}),
        },
        budget: {
            month,
            tokensUsed: totals.tokens,
            usdUsed: totals.usdComplete ? totals.usd : null,
            tokensPerMonth: config.budget.tokensPerMonth,
            usdPerMonth: config.budget.usdPerMonth,
        },
        config: { source, unknownKeys },
        ledger: store.describe(),
        credential: Boolean(apiKey) ? 'api-key' : hasStoredAuth(existingHome) ? 'stored-auth' : 'none',
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
}
async function commandReport(options) {
    const cwd = stringOption(options, 'cwd') ?? process.cwd();
    const { config: loaded } = await loadConfig(cwd, stringOption(options, 'config'));
    const config = clientConfigWithOverrides(loaded, options);
    const env = githubEnvFromProcess();
    const ctx = repoContextFromEnv(env);
    const repoSlug = ctx ? `${ctx.owner}/${ctx.repo}` : (stringOption(options, 'repo') ?? null);
    const store = config.state.mode === 'branch' && ctx
        ? createBranchStore(ctx, config.state.branch, config.state.path, null)
        : createFileStore(config.state.path, cwd);
    let records = [];
    try {
        records = await store.read();
    }
    catch (error) {
        log(`error: could not read ledger (${store.describe()}): ${error.message}`);
        return 2;
    }
    const month = stringOption(options, 'month') ?? monthKey(isoNow());
    const summary = summarize(records, { month, repo: repoSlug });
    if (stringOption(options, 'format') === 'json' || options['json'] === true) {
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    }
    else {
        process.stdout.write(`${renderReportMarkdown(summary)}\n`);
        appendStepSummary(renderReportMarkdown(summary));
    }
    return 0;
}
function printHelp() {
    process.stdout.write(`codex-meter ${TOOL_VERSION} — spend-aware Codex reviews for maintainers

Usage:
  codex-meter review [options]    run a policy-gated, metered Codex review
  codex-meter explain [options]   show the policy decision without spending anything
  codex-meter report [options]    summarise the ledger (spend, skips, findings)

Common options:
  --cwd <dir>                repository to inspect (default: current directory)
  --base <ref>               base ref (default: PR base branch, then origin/HEAD)
  --head <sha>               head commit (default: PR head, then HEAD)
  --pr <number>              pull request number for comments
  --config <file>            path to a config file (default: .codex-meter.json)
  --model <name>             Codex model (default: CLI default)
  --budget-tokens <n>        monthly token budget
  --budget-usd <n>           monthly dollar budget (needs a price entry)
  --max-changed-lines <n>    skip diffs larger than this
  --state <file|branch>      where the ledger lives
  --comment <upsert|off>     post or update a single PR comment
  --fail-on <severity>       critical|high|medium|low|info|never (default: high)
  --dry-run                  decide, but never spend or post
  --json                     machine-readable result on stdout
  --allow-fork-prs           run on fork pull requests (secrets are still unavailable)

Environment:
  CODEX_API_KEY              OpenAI API key for the Codex run (never exposed to the repo)
  GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_PATH, GITHUB_STEP_SUMMARY

Exit codes:
  0  no findings at or above --fail-on (skips and infrastructure errors also exit 0)
  1  findings at or above --fail-on
  2  usage or configuration error
`);
}
async function main(argv) {
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
            base: { type: 'string' },
            head: { type: 'string' },
            pr: { type: 'string' },
            cwd: { type: 'string' },
            config: { type: 'string' },
            ledger: { type: 'string' },
            state: { type: 'string' },
            model: { type: 'string' },
            'prompt-file': { type: 'string' },
            'timeout-ms': { type: 'string' },
            'codex-bin': { type: 'string' },
            'budget-tokens': { type: 'string' },
            'budget-usd': { type: 'string' },
            'run-tokens': { type: 'string' },
            'max-changed-lines': { type: 'string' },
            'min-changed-lines': { type: 'string' },
            'fail-on': { type: 'string' },
            comment: { type: 'string' },
            month: { type: 'string' },
            repo: { type: 'string' },
            format: { type: 'string' },
            json: { type: 'boolean' },
            'dry-run': { type: 'boolean' },
            'allow-fork-prs': { type: 'boolean' },
            'no-comment': { type: 'boolean' },
            'respect-user-config': { type: 'boolean' },
            help: { type: 'boolean' },
            version: { type: 'boolean' },
        },
    });
    const options = {
        base: values.base,
        head: values.head,
        pr: values.pr,
        cwd: values.cwd,
        config: values.config,
        ledger: values.ledger,
        state: values.state,
        model: values.model,
        promptFile: values['prompt-file'],
        timeoutMs: values['timeout-ms'],
        codexBin: values['codex-bin'],
        budgetTokens: values['budget-tokens'],
        budgetUsd: values['budget-usd'],
        runTokens: values['run-tokens'],
        maxChangedLines: values['max-changed-lines'],
        minChangedLines: values['min-changed-lines'],
        failOn: values['fail-on'],
        comment: values.comment,
        month: values.month,
        repo: values.repo,
        format: values.format,
        json: values.json === true,
        dryRun: values['dry-run'] === true,
        allowForkPrs: values['allow-fork-prs'] === true,
        noComment: values['no-comment'] === true,
        respectUserConfig: values['respect-user-config'] === true,
    };
    const command = positionals[0] ?? 'review';
    if (values.version === true) {
        process.stdout.write(`${TOOL_VERSION}\n`);
        return 0;
    }
    if (values.help === true || command === 'help') {
        printHelp();
        return 0;
    }
    switch (command) {
        case 'review':
            return commandReview(options);
        case 'explain':
            return commandExplain(options);
        case 'report':
            return commandReport(options);
        default:
            log(`error: unknown command "${command}"`);
            printHelp();
            return 2;
    }
}
const exitCode = await main(process.argv.slice(2)).catch((error) => {
    log(`error: ${error.message}`);
    return 2;
});
process.exit(exitCode);
//# sourceMappingURL=cli.js.map