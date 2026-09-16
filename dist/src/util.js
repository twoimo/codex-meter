export function isoNow(now = new Date()) {
    return now.toISOString();
}
export function monthKey(iso) {
    return iso.slice(0, 7);
}
export function formatTokens(value) {
    if (!Number.isFinite(value))
        return '0';
    if (Math.abs(value) >= 1_000_000)
        return `${(value / 1_000_000).toFixed(2)}M`;
    if (Math.abs(value) >= 1_000)
        return `${(value / 1_000).toFixed(1)}k`;
    return String(value);
}
export function formatUsd(value) {
    if (value === null || !Number.isFinite(value))
        return 'unknown';
    const digits = value !== 0 && Math.abs(value) < 1 ? 4 : 2;
    return `$${value.toFixed(digits)}`;
}
export function truncate(value, max) {
    if (value.length <= max)
        return value;
    return `${value.slice(0, Math.max(0, max - 1))}…`;
}
export function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
/** Escape a value for use inside a single Markdown table cell. */
export function mdCell(value) {
    if (value === null || value === undefined)
        return '';
    return String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n+/g, ' ').trim();
}
export function readStdin() {
    return new Promise((resolve) => {
        if (process.stdin.isTTY) {
            resolve('');
            return;
        }
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => {
            data += chunk;
        });
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', () => resolve(data));
    });
}
//# sourceMappingURL=util.js.map