import { COMMENT_MARKER } from './github.js';
import { SEVERITY_RANK, type Finding, type ReviewOutput, type Severity, type Usage } from './types.js';
import { formatTokens, formatUsd, mdCell, truncate } from './util.js';
import type { LedgerSummary } from './ledger.js';

export interface SpendLine {
  usage: Usage;
  costUsd: number | null;
  model: string | null;
  monthTokens: number | null;
  monthTokenBudget: number | null;
  monthUsd: number | null;
  monthUsdBudget: number | null;
}

export function budgetText(spend: SpendLine): string {
  const parts: string[] = [];
  if (spend.monthTokenBudget !== null) {
    const used = spend.monthTokens ?? 0;
    const percent = spend.monthTokenBudget > 0 ? Math.round((used / spend.monthTokenBudget) * 100) : 0;
    parts.push(`${formatTokens(used)} / ${formatTokens(spend.monthTokenBudget)} tokens this month (${percent}%)`);
  }
  if (spend.monthUsdBudget !== null) {
    parts.push(`${formatUsd(spend.monthUsd)} / ${formatUsd(spend.monthUsdBudget)} this month`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'no monthly budget configured';
}

export function displayBase(base: string): string {
  return base.replace(/^origin\//, '');
}

export function spendFooter(spend: SpendLine, meta: { shortSha: string; base: string; toolVersion: string; durationMs: number | null }): string {
  const usage = spend.usage;
  const tokens = [
    `in ${formatTokens(usage.inputTokens)}`,
    usage.cachedInputTokens > 0 ? `cached ${formatTokens(usage.cachedInputTokens)}` : null,
    `out ${formatTokens(usage.outputTokens + usage.reasoningOutputTokens)}`,
  ]
    .filter(Boolean)
    .join(' / ');

  const lines = [
    `<sub>codex-meter ${meta.toolVersion} · head ${meta.shortSha} · base ${mdCell(displayBase(meta.base))}${meta.durationMs !== null ? ` · ${Math.round(meta.durationMs / 1000)}s` : ''}</sub>`,
    `<sub>Spend: ${tokens}${usage.reasoningOutputTokens > 0 ? ` (reasoning ${formatTokens(usage.reasoningOutputTokens)})` : ''} · estimated ${formatUsd(spend.costUsd)}${spend.model ? ` · model ${mdCell(spend.model)}` : ''}</sub>`,
    `<sub>Budget: ${budgetText(spend)}</sub>`,
  ];
  return lines.join('\n');
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (bySeverity !== 0) return bySeverity;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return (a.line ?? 0) - (b.line ?? 0);
  });
}

const MAX_RENDERED = 20;

export function renderReviewComment(input: {
  review: ReviewOutput;
  spend: SpendLine;
  meta: { shortSha: string; base: string; toolVersion: string; durationMs: number | null; droppedFindings: number };
}): string {
  const { review } = input;
  const findings = sortFindings(review.findings);
  const body: string[] = [COMMENT_MARKER, '## codex-meter review', ''];

  if (review.summary) body.push(review.summary, '');
  body.push(`Risk: **${review.risk}** · findings: **${findings.length}**${input.meta.droppedFindings > 0 ? ` (${input.meta.droppedFindings} malformed entries dropped)` : ''}`, '');

  if (review.skipReview) {
    body.push('Codex classified this diff as mechanical; no findings were requested.', '');
  } else if (findings.length === 0) {
    body.push('No material defects found.', '');
  } else {
    body.push('| severity | location | finding |', '| --- | --- | --- |');
    for (const finding of findings.slice(0, MAX_RENDERED)) {
      const location = `${mdCell(finding.file)}${finding.line !== null ? `:${finding.line}` : ''}`;
      const detail = [finding.title, finding.suggestion ? `_Fix:_ ${finding.suggestion}` : null]
        .filter(Boolean)
        .join(' ');
      body.push(`| ${finding.severity} | \`${location}\` | ${mdCell(truncate(detail, 400))} |`);
    }
    body.push('');
    for (const finding of findings.slice(0, MAX_RENDERED)) {
      if (!finding.detail) continue;
      const location = `${finding.file}${finding.line !== null ? `:${finding.line}` : ''}`;
      body.push(
        `- **${finding.severity}** \`${location}\` — ${finding.title}`,
        `  - ${finding.detail}${finding.confidence !== null ? ` _(confidence ${finding.confidence})_` : ''}`,
      );
    }
    if (findings.length > MAX_RENDERED) {
      body.push('', `_${findings.length - MAX_RENDERED} further findings were omitted from this comment._`);
    }
    body.push('');
  }

  body.push(spendFooter(input.spend, input.meta));
  return body.join('\n');
}

export function renderSkipComment(input: {
  title: string;
  detail: string;
  meta: { shortSha: string; base: string; toolVersion: string };
  spend: SpendLine;
}): string {
  const body = [
    COMMENT_MARKER,
    '## codex-meter review',
    '',
    `**${input.title}**`,
    '',
    input.detail,
    '',
    spendFooter(input.spend, { ...input.meta, durationMs: null }),
  ];
  return body.join('\n');
}

export function renderErrorComment(input: {
  detail: string;
  stderrTail: string | null;
  spend: SpendLine;
  meta: { shortSha: string; base: string; toolVersion: string; durationMs: number | null };
}): string {
  const body = [
    COMMENT_MARKER,
    '## codex-meter review',
    '',
    `**The review did not complete:** ${input.detail}`,
    '',
    'The pull request was not blocked. Check the workflow log for details.',
  ];
  if (input.stderrTail) {
    body.push('', '<details><summary>codex stderr (last lines)</summary>', '', '```', truncate(input.stderrTail, 1500), '```', '</details>');
  }
  body.push('', spendFooter(input.spend, input.meta));
  return body.join('\n');
}

export function renderReportMarkdown(summary: LedgerSummary): string {
  const lines: string[] = [];
  lines.push(`## codex-meter report — ${summary.month}${summary.repo ? ` (${summary.repo})` : ''}`, '');
  lines.push(
    `Reviews: **${summary.totals.runs}** · skipped: **${summary.totals.skipped}** · tokens: **${formatTokens(summary.totals.tokens)}** · estimated spend: **${summary.totals.usdComplete ? formatUsd(summary.totals.usd) : `${formatUsd(summary.totals.usd)} (incomplete)`}**`,
    '',
  );
  lines.push(
    `Average per review: ${formatTokens(summary.averageTokensPerReview)} tokens${summary.averageUsdPerReview !== null ? ` (${formatUsd(summary.averageUsdPerReview)})` : ''} · cache hit ratio: ${summary.cacheHitRatio !== null ? `${Math.round(summary.cacheHitRatio * 100)}%` : 'n/a'} · reviews with findings: ${summary.reviewsWithFindings}`,
    '',
  );

  const severityRows = (Object.entries(summary.severities) as [Severity, number][])
    .filter(([, count]) => count > 0)
    .map(([severity, count]) => `| ${severity} | ${count} |`);
  lines.push('### Findings by severity', '', '| severity | count |', '| --- | --- |', ...severityRows, '');

  if (summary.skipReasons.length > 0) {
    lines.push('### Skips by reason', '', '| reason | count |', '| --- | --- |');
    for (const entry of summary.skipReasons) lines.push(`| ${entry.code} | ${entry.count} |`);
    lines.push('');
  }

  if (summary.topSpend.length > 0) {
    lines.push('### Most expensive reviews', '', '| pull request | head | tokens | estimated |', '| --- | --- | --- | --- |');
    for (const entry of summary.topSpend) {
      lines.push(
        `| ${entry.pr !== null ? `#${entry.pr}` : 'n/a'} | \`${entry.sha !== null ? entry.sha.slice(0, 8) : 'n/a'}\` | ${formatTokens(entry.tokens)} | ${formatUsd(entry.usd)} |`,
      );
    }
    lines.push('');
  }

  lines.push(`_Generated ${summary.generatedAt}._`);
  return lines.join('\n');
}
