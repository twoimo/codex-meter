export function isoNow(now: Date = new Date()): string {
  return now.toISOString();
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function formatTokens(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export function formatUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'unknown';
  const digits = value !== 0 && Math.abs(value) < 1 ? 4 : 2;
  return `$${value.toFixed(digits)}`;
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

export function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Escape a value for use inside a single Markdown table cell. */
export function mdCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n+/g, ' ').trim();
}

export function readStdin(): Promise<string> {
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
