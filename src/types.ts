export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

export interface Finding {
  severity: Severity;
  file: string;
  line: number | null;
  title: string;
  detail: string | null;
  suggestion: string | null;
  confidence: number | null;
}

export interface ReviewOutput {
  summary: string;
  risk: 'low' | 'medium' | 'high';
  findings: Finding[];
  skipReview: boolean;
}

export interface Usage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
};

export interface ChangedFile {
  path: string;
  added: number;
  deleted: number;
  binary: boolean;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'unknown';
}

export interface DiffStats {
  files: ChangedFile[];
  fileCount: number;
  added: number;
  deleted: number;
  changedLines: number;
}

export type DecisionCode =
  | 'run'
  | 'disabled'
  | 'draft'
  | 'label-skip'
  | 'fork-pr'
  | 'no-changes'
  | 'docs-only'
  | 'generated-only'
  | 'too-small'
  | 'too-large'
  | 'already-reviewed'
  | 'budget-exhausted'
  | 'no-credential'
  | 'error';

export interface Decision {
  run: boolean;
  code: DecisionCode;
  detail: string;
  notes: string[];
}

export interface BudgetState {
  monthTokens: number;
  monthUsd: number | null;
  runTokens: number;
  runUsd: number | null;
}

export interface LedgerRecord {
  schema: 1;
  ts: string;
  repo: string | null;
  pr: number | null;
  sha: string | null;
  base: string | null;
  decision: 'run' | 'skip' | 'budget-stop' | 'error';
  code: DecisionCode;
  tier: 'review' | 'none';
  model: string | null;
  usage: Usage;
  estCostUsd: number | null;
  durationMs: number | null;
  findings: Record<Severity, number>;
  toolVersion: string;
  /** free-form, sanitized note for reports (never contains secrets or diffs) */
  note: string | null;
}
