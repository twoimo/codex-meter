# Design notes

Decisions that are not obvious from the code, and the evidence behind them.

## Why `codex exec` and not `codex exec review`

The Codex CLI has a native `codex exec review --base <branch>` subcommand that produces a good review. It also reports **zero tokens** in its `turn.completed` events on codex-cli 0.153.4, which makes metering impossible. `codex exec` reports real usage (`input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`) and honours `--output-schema`, so the review prompt lives in [src/prompt.ts](../src/prompt.ts) and the answer shape lives in [schemas/findings.schema.json](../schemas/findings.schema.json).

Measured on the same repository and diff: `codex exec review` → `usage: 0`, `codex exec --output-schema` → `input 116,593 / output 4,642`. A metering tool that cannot see usage is a decoration, so the plain `exec` path wins.

## Why the gates run before the call

A trivial `codex exec` turn spends about 18k input tokens on system prompt, tool definitions and repository context before doing anything useful. There is no cheap Codex call, so the only way to control spend is to not make the call. Hence the ordered policy in [src/policy.ts](../src/policy.ts): metadata gates (draft, label, fork), then content gates (docs-only, generated-only, size), then dedupe (same head commit), then budgets, then the estimate. The first match wins and `explain` prints it.

## Why an append-only ledger

Budgets need durable state, and maintainers need to be able to explain a spend after the fact. A JSONL ledger gives both: one record per decision (including skips and budget stops, not just runs), append-only, easy to grep, easy to aggregate in `report`, and small enough to keep on a state branch. Records deliberately exclude diffs and prompts: they hold counts, tokens, costs and a short reason string.

`state: branch` writes through the GitHub contents API instead of doing git surgery in the workspace, so it works with `persist-credentials: false` and never touches the checked-out tree. Concurrent runs for one repository are serialised with a `concurrency` group in the workflow example.

## Why one upserted comment

Most review bots post a new comment per push, which trains maintainers to ignore them. One comment, identified by `<!-- codex-meter:summary -->`, updated in place, with the spend attached, keeps the signal in one place and makes the cost visible next to the findings.

## Why it never fixes the code

Agentic pull requests are rejected for reasons unrelated to code quality: reviewers distrust AI-authored changes, oversized diffs and unexplained edits. A review comment that a human acts on is more useful to a maintainer than a branch that has to be verified from scratch. `codex-meter` therefore reports findings, stays read-only, and does not commit, push, approve or resolve anything.

## Non-goals

- Replacing human review or blocking merges on its own (the exit code is a project choice, defaulting to `high`).
- Optimising the cost of a single call. It decides whether to call and reports what the call cost.
- Being an agent framework. It is a thin, testable layer over the Codex CLI.

## Possible next steps

- Inline review comments per finding, behind a flag, with the same upsert discipline.
- A triage tier: a cheap model decides whether a diff deserves the expensive review, with both tiers metered.
- Per-path budgets (for example, expensive reviews only for `src/` and migrations).
- An MCP server mode so an agent can ask "what is my remaining review budget?" before proposing a review.
