import { readFile } from 'node:fs/promises';
/**
 * Default review prompt. Kept deliberately narrow: findings only, no edits, and
 * an explicit instruction to stay silent when nothing material changed, because
 * every extra paragraph is billed output tokens.
 */
export const DEFAULT_REVIEW_PROMPT = `You are reviewing a change in the repository checked out in your working directory, on behalf of the maintainers.

Rules:
- Report only defects that a maintainer would act on: correctness bugs, security issues, data loss, resource leaks, concurrency, error handling gaps, breaking API or behaviour changes, missing validation, and tests that assert the wrong thing.
- Do not report formatting, naming, import ordering, or pure style preferences.
- Do not report pre-existing problems in untouched code unless the change makes them reachable.
- If the repository has an AGENTS.md or CONTRIBUTING guidance, follow it for severity and expectations.
- Open only the files you need for context. Do not modify files and do not run destructive commands.
- Every finding must point at a specific file, and at a line when you can identify one.
- If the change is fine, return an empty findings array and set skipReview to false with a one-sentence summary.
- Keep detail and suggestion to one or two sentences each. Set confidence to your honest probability (0-1) that the finding is a real defect.
- Answer with the requested JSON object only.`;
export async function resolvePrompt(promptFile, cwd) {
    if (!promptFile)
        return DEFAULT_REVIEW_PROMPT;
    const path = promptFile.startsWith('/') ? promptFile : `${cwd}/${promptFile}`;
    const text = await readFile(path, 'utf8');
    return text.trim().length > 0 ? text : DEFAULT_REVIEW_PROMPT;
}
//# sourceMappingURL=prompt.js.map