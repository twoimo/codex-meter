import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_PRICING } from './pricing.js';
export const DEFAULT_CONFIG = {
    enabled: true,
    skipLabel: 'skip-codex-meter',
    skipBotAuthors: true,
    allowForkPrs: false,
    skipDocsOnly: true,
    skipGeneratedOnly: true,
    minChangedLines: 0,
    maxChangedLines: 4000,
    model: null,
    budget: {
        // Roughly ten measured reviews a month (about 120k tokens each).
        tokensPerMonth: 1_200_000,
        usdPerMonth: null,
        tokensPerRun: 400_000,
        usdPerRun: null,
    },
    state: {
        mode: 'file',
        path: '.codex-meter/ledger.jsonl',
        branch: 'codex-meter-state',
    },
    comment: 'upsert',
    failOn: 'high',
    codexBin: 'codex',
    codexArgs: [],
    promptFile: null,
    timeoutMs: 15 * 60 * 1000,
    ignoreUserConfig: true,
    estimate: {
        baselineTokens: 100_000,
        tokensPerChangedLine: 1_500,
        outputBaselineTokens: 3_000,
        outputTokensPerChangedLine: 60,
    },
    pricing: { ...DEFAULT_PRICING },
    dryRun: false,
};
export const CONFIG_FILENAMES = ['.codex-meter.json', path.join('.github', 'codex-meter.json')];
function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function pickNumber(source, key) {
    const raw = source[key];
    if (raw === undefined)
        return undefined;
    if (raw === null)
        return null;
    const num = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(num) ? num : undefined;
}
function pickBoolean(source, key) {
    const raw = source[key];
    return typeof raw === 'boolean' ? raw : undefined;
}
function pickString(source, key) {
    const raw = source[key];
    if (raw === undefined)
        return undefined;
    if (raw === null)
        return null;
    return typeof raw === 'string' ? raw : undefined;
}
/**
 * Apply a parsed config file onto a config object. Only known keys are read so a
 * typo cannot silently change behaviour, and unknown keys are reported back.
 */
export function applyFileConfig(base, raw) {
    const config = structuredClone(base);
    const unknownKeys = [];
    for (const [key, value] of Object.entries(raw)) {
        switch (key) {
            case 'enabled': {
                const v = pickBoolean(raw, key);
                if (v !== undefined)
                    config.enabled = v;
                break;
            }
            case 'skipLabel': {
                const v = pickString(raw, key);
                if (typeof v === 'string')
                    config.skipLabel = v;
                break;
            }
            case 'skipBotAuthors': {
                const v = pickBoolean(raw, key);
                if (v !== undefined)
                    config.skipBotAuthors = v;
                break;
            }
            case 'allowForkPrs': {
                const v = pickBoolean(raw, key);
                if (v !== undefined)
                    config.allowForkPrs = v;
                break;
            }
            case 'skipDocsOnly': {
                const v = pickBoolean(raw, key);
                if (v !== undefined)
                    config.skipDocsOnly = v;
                break;
            }
            case 'skipGeneratedOnly': {
                const v = pickBoolean(raw, key);
                if (v !== undefined)
                    config.skipGeneratedOnly = v;
                break;
            }
            case 'minChangedLines': {
                const v = pickNumber(raw, key);
                if (typeof v === 'number')
                    config.minChangedLines = v;
                break;
            }
            case 'maxChangedLines': {
                const v = pickNumber(raw, key);
                if (typeof v === 'number')
                    config.maxChangedLines = v;
                break;
            }
            case 'model': {
                const v = pickString(raw, key);
                if (v !== undefined)
                    config.model = v;
                break;
            }
            case 'codexBin': {
                const v = pickString(raw, key);
                if (typeof v === 'string')
                    config.codexBin = v;
                break;
            }
            case 'promptFile': {
                const v = pickString(raw, key);
                if (v !== undefined)
                    config.promptFile = v;
                break;
            }
            case 'timeoutMs': {
                const v = pickNumber(raw, key);
                if (typeof v === 'number')
                    config.timeoutMs = v;
                break;
            }
            case 'ignoreUserConfig': {
                const v = pickBoolean(raw, key);
                if (v !== undefined)
                    config.ignoreUserConfig = v;
                break;
            }
            case 'codexArgs': {
                if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
                    config.codexArgs = value;
                }
                break;
            }
            case 'comment': {
                if (value === 'upsert' || value === 'off')
                    config.comment = value;
                break;
            }
            case 'failOn': {
                if (value === 'never' || (typeof value === 'string' && ['critical', 'high', 'medium', 'low', 'info'].includes(value))) {
                    config.failOn = value;
                }
                break;
            }
            case 'budget': {
                if (isObject(value)) {
                    for (const [budgetKey, budgetValue] of Object.entries(value)) {
                        switch (budgetKey) {
                            case 'tokensPerMonth':
                            case 'usdPerMonth':
                            case 'tokensPerRun':
                            case 'usdPerRun': {
                                const parsed = pickNumber(value, budgetKey);
                                if (parsed !== undefined)
                                    config.budget[budgetKey] = parsed;
                                break;
                            }
                            default:
                                unknownKeys.push(`budget.${budgetKey}`);
                        }
                    }
                }
                break;
            }
            case 'state': {
                if (isObject(value)) {
                    for (const [stateKey, stateValue] of Object.entries(value)) {
                        switch (stateKey) {
                            case 'mode': {
                                if (stateValue === 'file' || stateValue === 'branch')
                                    config.state.mode = stateValue;
                                break;
                            }
                            case 'path': {
                                if (typeof stateValue === 'string')
                                    config.state.path = stateValue;
                                break;
                            }
                            case 'branch': {
                                if (typeof stateValue === 'string')
                                    config.state.branch = stateValue;
                                break;
                            }
                            default:
                                unknownKeys.push(`state.${stateKey}`);
                        }
                    }
                }
                break;
            }
            case 'estimate': {
                if (isObject(value)) {
                    for (const estimateKey of Object.keys(config.estimate)) {
                        const parsed = pickNumber(value, estimateKey);
                        if (typeof parsed === 'number') {
                            config.estimate[estimateKey] = parsed;
                        }
                    }
                }
                break;
            }
            case 'pricing': {
                if (isObject(value)) {
                    const parsed = {};
                    for (const [model, price] of Object.entries(value)) {
                        if (!isObject(price))
                            continue;
                        const input = pickNumber(price, 'input');
                        const output = pickNumber(price, 'output');
                        if (typeof input !== 'number' || typeof output !== 'number')
                            continue;
                        const cachedInput = pickNumber(price, 'cachedInput');
                        const cacheWrite = pickNumber(price, 'cacheWrite');
                        parsed[model] = {
                            input,
                            output,
                            cachedInput: typeof cachedInput === 'number' ? cachedInput : null,
                            cacheWrite: typeof cacheWrite === 'number' ? cacheWrite : null,
                        };
                    }
                    config.pricing = { ...config.pricing, ...parsed };
                }
                break;
            }
            default:
                unknownKeys.push(key);
        }
    }
    return { config, unknownKeys };
}
export async function loadConfigFile(cwd, explicitPath) {
    const candidates = explicitPath ? [explicitPath] : CONFIG_FILENAMES.map((name) => path.join(cwd, name));
    for (const candidate of candidates) {
        try {
            const text = await readFile(candidate, 'utf8');
            const parsed = JSON.parse(text);
            if (isObject(parsed))
                return parsed;
            return null;
        }
        catch (error) {
            const code = error.code;
            if (code === 'ENOENT')
                continue;
            throw new Error(`failed to read config ${candidate}: ${error.message}`);
        }
    }
    return null;
}
export async function loadConfig(cwd, explicitPath) {
    const raw = await loadConfigFile(cwd, explicitPath);
    if (!raw)
        return { config: structuredClone(DEFAULT_CONFIG), unknownKeys: [], source: null };
    const { config, unknownKeys } = applyFileConfig(DEFAULT_CONFIG, raw);
    return { config, unknownKeys, source: explicitPath ?? CONFIG_FILENAMES[0] ?? null };
}
export function configToJson(config) {
    return JSON.stringify(config, null, 2);
}
//# sourceMappingURL=config.js.map