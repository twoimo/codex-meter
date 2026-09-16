/**
 * Prices are USD per 1M tokens, taken from the official OpenAI pricing page.
 * They are a snapshot, not a live quote: verify before you rely on them for billing.
 */
export const PRICING_SOURCE = {
    url: 'https://developers.openai.com/api/docs/pricing',
    retrieved: '2026-09-16',
};
export const DEFAULT_PRICING = {
    'gpt-6-astra': { input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50 },
    'gpt-5.6-sol': { input: 4, cachedInput: 0.4, cacheWrite: 5, output: 20 },
    'gpt-5.6-terra': { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 12 },
    'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 1.2 },
    'gpt-5.5-pro': { input: 30, cachedInput: null, cacheWrite: null, output: 180 },
    'gpt-5.5': { input: 5, cachedInput: 0.5, cacheWrite: null, output: 30 },
    'gpt-5.4-pro': { input: 30, cachedInput: null, cacheWrite: null, output: 180 },
    'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, cacheWrite: null, output: 4.5 },
    'gpt-5.4-nano': { input: 0.2, cachedInput: 0.02, cacheWrite: null, output: 1.25 },
    'gpt-5.4': { input: 2.5, cachedInput: 0.25, cacheWrite: null, output: 15 },
    'gpt-5.2-pro': { input: 21, cachedInput: null, cacheWrite: null, output: 168 },
    'gpt-5.2': { input: 1.75, cachedInput: 0.175, cacheWrite: null, output: 14 },
    'gpt-5.1': { input: 1.25, cachedInput: 0.125, cacheWrite: null, output: 10 },
    'gpt-5-mini': { input: 0.25, cachedInput: 0.025, cacheWrite: null, output: 2 },
    'gpt-5-nano': { input: 0.05, cachedInput: 0.005, cacheWrite: null, output: 0.4 },
    'gpt-5-pro': { input: 15, cachedInput: null, cacheWrite: null, output: 120 },
    'gpt-5': { input: 1.25, cachedInput: 0.125, cacheWrite: null, output: 10 },
};
function segments(model) {
    return model
        .toLowerCase()
        .replace(/[^a-z0-9.-]+/g, '-')
        .split('-')
        .filter(Boolean);
}
/**
 * Resolve a model name to a price. `gpt-5.4-codex` resolves to `gpt-5.4` and is
 * reported as approximate so callers can tell users their numbers are estimates.
 */
export function priceFor(model, table = DEFAULT_PRICING) {
    if (!model)
        return null;
    const key = model.trim().toLowerCase();
    const exact = table[key];
    if (exact)
        return { model: key, price: exact, approximate: false };
    const parts = segments(key);
    for (let take = parts.length - 1; take >= 2; take -= 1) {
        const candidate = parts.slice(0, take).join('-');
        const hit = table[candidate];
        if (hit)
            return { model: candidate, price: hit, approximate: true };
    }
    return null;
}
const perMillion = (tokens, rate) => rate === null ? 0 : (Math.max(0, tokens) / 1_000_000) * rate;
export function costUsd(usage, price) {
    const inputUsd = perMillion(usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteInputTokens, price.input);
    const cachedInputUsd = perMillion(usage.cachedInputTokens, price.cachedInput);
    const cacheWriteUsd = perMillion(usage.cacheWriteInputTokens, price.cacheWrite);
    const outputUsd = perMillion(usage.outputTokens + usage.reasoningOutputTokens, price.output);
    return {
        inputUsd,
        cachedInputUsd,
        cacheWriteUsd,
        outputUsd,
        totalUsd: inputUsd + cachedInputUsd + cacheWriteUsd + outputUsd,
    };
}
export function roundUsd(value) {
    return Math.round(value * 1e6) / 1e6;
}
//# sourceMappingURL=pricing.js.map