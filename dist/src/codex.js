import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { EMPTY_USAGE, SEVERITIES, } from './types.js';
import { safeJsonParse } from './util.js';
export function resolveCodexHome(explicit) {
    if (explicit)
        return explicit;
    if (process.env.CODEX_HOME)
        return process.env.CODEX_HOME;
    return path.join(homedir(), '.codex');
}
/**
 * Store an API key with `codex login --with-api-key` inside a throwaway Codex
 * home, so the key never sits in the environment of the Codex process (and so
 * cannot be read by commands that Codex runs in the checked-out repository).
 */
export async function loginWithApiKey(bin, apiKey, codexHome) {
    await mkdir(codexHome, { recursive: true });
    return new Promise((resolve) => {
        const child = spawn(bin, ['login', '--with-api-key'], {
            env: { ...process.env, CODEX_HOME: codexHome, CODEX_API_KEY: '', OPENAI_API_KEY: '' },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stderr = '';
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });
        child.stdout.on('data', () => undefined);
        child.on('error', (error) => resolve({ ok: false, message: error.message }));
        child.on('close', (code) => {
            if (code === 0) {
                resolve({ ok: true, message: 'logged in with API key' });
            }
            else {
                resolve({ ok: false, message: `codex login exited ${code}: ${stderr.trim().split('\n').slice(-1)[0] ?? ''}` });
            }
        });
        child.stdin.write(apiKey);
        child.stdin.end();
    });
}
export async function createThrowawayCodexHome() {
    return mkdtemp(path.join(tmpdir(), 'codex-meter-'));
}
export async function removeCodexHome(dir) {
    try {
        await rm(dir, { recursive: true, force: true });
    }
    catch {
        // best effort: a throwaway directory that cannot be removed is not fatal
    }
}
/**
 * The CLI is chatty on stderr; these lines carry no diagnostic value and would
 * otherwise push the real error out of the comment.
 */
const STDERR_NOISE = [
    /^Reading additional input from stdin/i,
    /^WARNING: proceeding, even though we could not create PATH aliases/i,
    /failed to connect to websocket/i,
];
function tomlString(value) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
/**
 * Codex CLI config overrides for an OpenAI-compatible gateway. Passed with `-c`
 * so they apply even when the user config is ignored (the default in CI).
 */
export function providerArgs(provider, model) {
    const modelId = provider.model ?? model;
    const args = [
        '-c',
        `model_provider=${tomlString(provider.name)}`,
        '-c',
        `model_providers.${provider.name}.name=${tomlString(provider.name)}`,
        '-c',
        `model_providers.${provider.name}.base_url=${tomlString(provider.baseUrl)}`,
        '-c',
        `model_providers.${provider.name}.env_key=${tomlString(provider.envKey)}`,
        '-c',
        `model_providers.${provider.name}.wire_api=${tomlString(provider.wireApi)}`,
    ];
    if (modelId)
        args.push('-c', `model=${tomlString(modelId)}`);
    return args;
}
export function providerCredentialPresent(provider) {
    if (!provider)
        return false;
    const value = process.env[provider.envKey];
    return typeof value === 'string' && value.trim().length > 0;
}
function numberFrom(source, ...keys) {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'number' && Number.isFinite(value))
            return value;
    }
    return 0;
}
export function parseJsonl(text) {
    const events = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{'))
            continue;
        const parsed = safeJsonParse(trimmed);
        if (parsed)
            events.push(parsed);
    }
    return events;
}
export function accumulateUsage(events) {
    const usage = { ...EMPTY_USAGE };
    let model = null;
    let failureReason = null;
    for (const event of events) {
        if (event['type'] === 'turn.failed') {
            const error = event['error'];
            if (typeof error?.['message'] === 'string')
                failureReason = error['message'];
        }
        const item = event['item'];
        if (item?.['type'] === 'error' && typeof item['message'] === 'string' && failureReason === null) {
            failureReason = item['message'];
        }
        const rawUsage = (event['usage'] ?? (typeof event['msg'] === 'object' && event['msg'] !== null
            ? event['msg']['usage']
            : undefined));
        if (rawUsage && typeof rawUsage === 'object') {
            usage.inputTokens += numberFrom(rawUsage, 'input_tokens', 'inputTokens');
            usage.cachedInputTokens += numberFrom(rawUsage, 'cached_input_tokens', 'cachedInputTokens');
            usage.cacheWriteInputTokens += numberFrom(rawUsage, 'cache_write_input_tokens', 'cacheWriteInputTokens');
            usage.outputTokens += numberFrom(rawUsage, 'output_tokens', 'outputTokens');
            usage.reasoningOutputTokens += numberFrom(rawUsage, 'reasoning_output_tokens', 'reasoningOutputTokens');
        }
        const candidate = event['model'] ?? event['item']?.['model'];
        if (typeof candidate === 'string' && candidate.length > 0 && model === null)
            model = candidate;
    }
    return { usage, model, failureReason };
}
export function buildReviewPrompt(prompt, base, head) {
    const withRefs = prompt.replaceAll('{{base}}', base).replaceAll('{{head}}', head);
    if (prompt.includes('{{base}}'))
        return withRefs;
    return `${withRefs}\n\nDiff under review: \`git diff ${base}...${head}\` (base ${base}, head ${head}). Examine that diff and the files it touches.`;
}
/** Findings sometimes come back with absolute paths; keep them repo-relative. */
export function normaliseFilePath(file, cwd) {
    let next = file.trim().replace(/^file:\/\//, '');
    if (cwd) {
        const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`;
        if (next.startsWith(prefix))
            next = next.slice(prefix.length);
    }
    return next.replace(/^\.\//, '');
}
function severityOf(value) {
    if (typeof value !== 'string')
        return null;
    const normalized = value.toLowerCase();
    return SEVERITIES.includes(normalized) ? normalized : null;
}
/**
 * Normalise the model's JSON answer. Unusable findings are dropped rather than
 * failing the run, and the count of dropped entries is reported to the caller.
 */
export function normalizeReview(raw, cwd) {
    if (typeof raw !== 'object' || raw === null)
        return { review: null, dropped: 0 };
    const source = raw;
    const findingsRaw = Array.isArray(source['findings']) ? source['findings'] : [];
    const findings = [];
    let dropped = 0;
    for (const entry of findingsRaw) {
        if (typeof entry !== 'object' || entry === null) {
            dropped += 1;
            continue;
        }
        const item = entry;
        const severity = severityOf(item['severity']);
        const rawFile = typeof item['file'] === 'string' ? item['file'].trim() : '';
        const file = rawFile ? normaliseFilePath(rawFile, cwd) : '';
        const title = typeof item['title'] === 'string' ? item['title'].trim() : '';
        if (!severity || !file || !title) {
            dropped += 1;
            continue;
        }
        const lineValue = item['line'];
        const line = typeof lineValue === 'number' && Number.isInteger(lineValue) && lineValue > 0 ? lineValue : null;
        const confidenceValue = item['confidence'];
        const confidence = typeof confidenceValue === 'number' && confidenceValue >= 0 && confidenceValue <= 1 ? confidenceValue : null;
        findings.push({
            severity,
            file,
            line,
            title,
            detail: typeof item['detail'] === 'string' ? item['detail'].trim() : null,
            suggestion: typeof item['suggestion'] === 'string' ? item['suggestion'].trim() : null,
            confidence,
        });
    }
    const risk = source['risk'];
    return {
        review: {
            summary: typeof source['summary'] === 'string' ? source['summary'].trim() : '',
            risk: risk === 'low' || risk === 'medium' || risk === 'high' ? risk : 'medium',
            findings,
            skipReview: source['skipReview'] === true,
        },
        dropped,
    };
}
function extractJsonBlock(text) {
    const direct = safeJsonParse(text.trim());
    if (direct)
        return direct;
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    if (fenced?.[1]) {
        const parsed = safeJsonParse(fenced[1].trim());
        if (parsed)
            return parsed;
    }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        return safeJsonParse(text.slice(firstBrace, lastBrace + 1));
    }
    return null;
}
export async function runCodexReview(invocation) {
    const startedAt = Date.now();
    const args = [
        'exec',
        // `codex exec` (not the native review subcommand) is used on purpose: it
        // reports real token usage in `turn.completed`, which `codex exec review`
        // does not (measured 0 tokens on codex-cli 0.153.4), and metering is the
        // whole point of this tool.
        '--json',
        '--ephemeral',
        '--output-schema',
        invocation.schemaPath,
        '-o',
        invocation.outputFile,
    ];
    // The working root comes from the process cwd.
    if (invocation.provider) {
        args.push(...providerArgs(invocation.provider, invocation.model));
    }
    else if (invocation.model) {
        args.push('-m', invocation.model);
    }
    if (invocation.ignoreUserConfig)
        args.push('--ignore-user-config');
    args.push(...invocation.codexArgs);
    args.push('-');
    const childEnv = { ...process.env, CODEX_HOME: invocation.codexHome };
    // The key was already stored via `codex login`; keep it out of this process tree.
    delete childEnv['CODEX_API_KEY'];
    delete childEnv['OPENAI_API_KEY'];
    return new Promise((resolve) => {
        const child = spawn(invocation.bin, args, {
            cwd: invocation.cwd,
            env: childEnv,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
        }, invocation.timeoutMs);
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', (error) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve({
                exitCode: null,
                durationMs: Date.now() - startedAt,
                usage: { ...EMPTY_USAGE },
                model: invocation.model,
                review: null,
                finalMessage: null,
                errorKind: 'spawn',
                failureReason: error.message,
                stderrTail: error.message,
            });
        });
        child.on('close', async (code) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            const events = parseJsonl(stdout);
            const { usage, model, failureReason } = accumulateUsage(events);
            let finalMessage = null;
            try {
                if (existsSync(invocation.outputFile)) {
                    finalMessage = await readFile(invocation.outputFile, 'utf8');
                }
            }
            catch {
                finalMessage = null;
            }
            if (!finalMessage) {
                const messages = events
                    .filter((event) => event['item']?.['type'] === 'agent_message')
                    .map((event) => event['item']['text'])
                    .filter((text) => typeof text === 'string');
                finalMessage = messages.length > 0 ? (messages[messages.length - 1] ?? null) : null;
            }
            const { review } = finalMessage
                ? normalizeReview(extractJsonBlock(finalMessage), invocation.cwd)
                : { review: null };
            const errorKind = timedOut
                ? 'timeout'
                : code !== 0
                    ? 'nonzero'
                    : review
                        ? 'none'
                        : 'unparsed-review';
            const stderrTail = stderr
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.length > 0 && !STDERR_NOISE.some((pattern) => pattern.test(line)))
                .slice(-5)
                .join('\n');
            resolve({
                exitCode: code,
                durationMs: Date.now() - startedAt,
                usage,
                model: model ?? invocation.model,
                review,
                finalMessage,
                errorKind,
                failureReason: failureReason ?? (errorKind === 'timeout' ? `no result after ${invocation.timeoutMs}ms` : null),
                stderrTail,
            });
        });
        child.stdin.write(buildReviewPrompt(invocation.prompt, invocation.base, invocation.head));
        child.stdin.end();
    });
}
export function hasStoredAuth(codexHome) {
    return existsSync(path.join(codexHome, 'auth.json'));
}
//# sourceMappingURL=codex.js.map