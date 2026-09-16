import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Severity } from './types.js';
import { DEFAULT_PRICING, type ModelPrice } from './pricing.js';

export interface BudgetConfig {
  /** Hard ceiling for the current calendar month (UTC). null disables the check. */
  tokensPerMonth: number | null;
  /** Requires a pricing table entry for the model in use. */
  usdPerMonth: number | null;
  tokensPerRun: number | null;
  usdPerRun: number | null;
}

export interface StateConfig {
  /** `file` is per-run; `branch` persists the ledger so monthly budgets hold across runs. */
  mode: 'file' | 'branch';
  path: string;
  branch: string;
}

export interface EstimateConfig {
  /**
   * Calibrated on 2026-09-16 against codex-cli 0.153.4: a 23-line diff cost
   * ~116k input (104k cached) and ~4.6k output tokens, because the agent reads
   * files and runs read-only commands across several turns. Re-check these
   * numbers with `codex-meter report` once you have real runs in the ledger.
   */
  baselineTokens: number;
  tokensPerChangedLine: number;
  outputBaselineTokens: number;
  outputTokensPerChangedLine: number;
}

export interface ProviderConfig {
  /** Provider id handed to the Codex CLI (`model_providers` key). */
  name: string;
  /** OpenAI-compatible base URL, for example https://opencode.ai/zen/go/v1 */
  baseUrl: string;
  /** Environment variable that holds the provider key. */
  envKey: string;
  /** Wire protocol the gateway speaks. Current Codex CLI versions reject "chat". */
  wireApi: 'chat' | 'responses';
  /** Model id to request; falls back to `model` when null. */
  model: string | null;
}

export interface MeterConfig {
  enabled: boolean;
  skipLabel: string;
  skipBotAuthors: boolean;
  allowForkPrs: boolean;
  skipDocsOnly: boolean;
  skipGeneratedOnly: boolean;
  minChangedLines: number;
  maxChangedLines: number;
  model: string | null;
  /** Non-OpenAI Codex provider (OpenAI-compatible gateway). */
  provider: ProviderConfig | null;
  budget: BudgetConfig;
  state: StateConfig;
  comment: 'upsert' | 'off';
  failOn: Severity | 'never';
  codexBin: string;
  codexArgs: string[];
  promptFile: string | null;
  timeoutMs: number;
  ignoreUserConfig: boolean;
  estimate: EstimateConfig;
  pricing: Record<string, ModelPrice>;
  dryRun: boolean;
}

export const DEFAULT_CONFIG: MeterConfig = {
  enabled: true,
  skipLabel: 'skip-codex-meter',
  skipBotAuthors: true,
  allowForkPrs: false,
  skipDocsOnly: true,
  skipGeneratedOnly: true,
  minChangedLines: 0,
  maxChangedLines: 4000,
  model: null,
  provider: null,
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

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickNumber(source: Json, key: string): number | null | undefined {
  const raw = source[key];
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const num = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(num) ? num : undefined;
}

function pickBoolean(source: Json, key: string): boolean | undefined {
  const raw = source[key];
  return typeof raw === 'boolean' ? raw : undefined;
}

function pickString(source: Json, key: string): string | null | undefined {
  const raw = source[key];
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  return typeof raw === 'string' ? raw : undefined;
}

/**
 * Apply a parsed config file onto a config object. Only known keys are read so a
 * typo cannot silently change behaviour, and unknown keys are reported back.
 */
export function applyFileConfig(base: MeterConfig, raw: Json): { config: MeterConfig; unknownKeys: string[] } {
  const config: MeterConfig = structuredClone(base);
  const unknownKeys: string[] = [];

  for (const [key, value] of Object.entries(raw)) {
    switch (key) {
      case 'enabled': {
        const v = pickBoolean(raw, key);
        if (v !== undefined) config.enabled = v;
        break;
      }
      case 'skipLabel': {
        const v = pickString(raw, key);
        if (typeof v === 'string') config.skipLabel = v;
        break;
      }
      case 'skipBotAuthors': {
        const v = pickBoolean(raw, key);
        if (v !== undefined) config.skipBotAuthors = v;
        break;
      }
      case 'allowForkPrs': {
        const v = pickBoolean(raw, key);
        if (v !== undefined) config.allowForkPrs = v;
        break;
      }
      case 'skipDocsOnly': {
        const v = pickBoolean(raw, key);
        if (v !== undefined) config.skipDocsOnly = v;
        break;
      }
      case 'skipGeneratedOnly': {
        const v = pickBoolean(raw, key);
        if (v !== undefined) config.skipGeneratedOnly = v;
        break;
      }
      case 'minChangedLines': {
        const v = pickNumber(raw, key);
        if (typeof v === 'number') config.minChangedLines = v;
        break;
      }
      case 'maxChangedLines': {
        const v = pickNumber(raw, key);
        if (typeof v === 'number') config.maxChangedLines = v;
        break;
      }
      case 'model': {
        const v = pickString(raw, key);
        if (v !== undefined) config.model = v;
        break;
      }
      case 'codexBin': {
        const v = pickString(raw, key);
        if (typeof v === 'string') config.codexBin = v;
        break;
      }
      case 'promptFile': {
        const v = pickString(raw, key);
        if (v !== undefined) config.promptFile = v;
        break;
      }
      case 'timeoutMs': {
        const v = pickNumber(raw, key);
        if (typeof v === 'number') config.timeoutMs = v;
        break;
      }
      case 'ignoreUserConfig': {
        const v = pickBoolean(raw, key);
        if (v !== undefined) config.ignoreUserConfig = v;
        break;
      }
      case 'codexArgs': {
        if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
          config.codexArgs = value as string[];
        }
        break;
      }
      case 'comment': {
        if (value === 'upsert' || value === 'off') config.comment = value;
        break;
      }
      case 'failOn': {
        if (value === 'never' || (typeof value === 'string' && ['critical', 'high', 'medium', 'low', 'info'].includes(value))) {
          config.failOn = value as MeterConfig['failOn'];
        }
        break;
      }
      case 'provider': {
        if (value === null) {
          config.provider = null;
          break;
        }
        if (isObject(value)) {
          const name = pickString(value, 'name');
          const baseUrl = pickString(value, 'baseUrl');
          const envKey = pickString(value, 'envKey');
          const wireApi = pickString(value, 'wireApi') ?? 'responses';
          const providerModel = pickString(value, 'model');
          if (typeof name === 'string' && name.length > 0 && typeof baseUrl === 'string' && baseUrl.length > 0 && typeof envKey === 'string' && envKey.length > 0) {
            if (wireApi === 'chat' || wireApi === 'responses') {
              config.provider = { name, baseUrl, envKey, wireApi, model: providerModel ?? null };
            } else {
              unknownKeys.push('provider.wireApi');
            }
          } else {
            unknownKeys.push('provider');
          }
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
                if (parsed !== undefined) config.budget[budgetKey] = parsed;
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
                if (stateValue === 'file' || stateValue === 'branch') config.state.mode = stateValue;
                break;
              }
              case 'path': {
                if (typeof stateValue === 'string') config.state.path = stateValue;
                break;
              }
              case 'branch': {
                if (typeof stateValue === 'string') config.state.branch = stateValue;
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
              (config.estimate as unknown as Record<string, number>)[estimateKey] = parsed;
            }
          }
        }
        break;
      }
      case 'pricing': {
        if (isObject(value)) {
          const parsed: Record<string, ModelPrice> = {};
          for (const [model, price] of Object.entries(value)) {
            if (!isObject(price)) continue;
            const input = pickNumber(price, 'input');
            const output = pickNumber(price, 'output');
            if (typeof input !== 'number' || typeof output !== 'number') continue;
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

export async function loadConfigFile(cwd: string, explicitPath?: string | null): Promise<Json | null> {
  const candidates = explicitPath ? [explicitPath] : CONFIG_FILENAMES.map((name) => path.join(cwd, name));
  for (const candidate of candidates) {
    try {
      const text = await readFile(candidate, 'utf8');
      const parsed = JSON.parse(text) as unknown;
      if (isObject(parsed)) return parsed;
      return null;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') continue;
      throw new Error(`failed to read config ${candidate}: ${(error as Error).message}`);
    }
  }
  return null;
}

export async function loadConfig(
  cwd: string,
  explicitPath?: string | null,
): Promise<{ config: MeterConfig; unknownKeys: string[]; source: string | null }> {
  const raw = await loadConfigFile(cwd, explicitPath);
  if (!raw) return { config: structuredClone(DEFAULT_CONFIG), unknownKeys: [], source: null };
  const { config, unknownKeys } = applyFileConfig(DEFAULT_CONFIG, raw);
  return { config, unknownKeys, source: explicitPath ?? CONFIG_FILENAMES[0] ?? null };
}

export function configToJson(config: MeterConfig): string {
  return JSON.stringify(config, null, 2);
}
