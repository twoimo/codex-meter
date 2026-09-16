# codex-meter

[![ci](https://github.com/twoimo/codex-meter/actions/workflows/ci.yml/badge.svg)](https://github.com/twoimo/codex-meter/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![node](https://img.shields.io/badge/node-20%20%7C%2022-brightgreen)

Spend-aware Codex automation for open source maintainers: policy gates, monthly budget enforcement, an audit ledger, and PR spend reports.

Codex review is genuinely useful and genuinely expensive. A single review of a 23-line diff measured **116,593 input / 4,642 output tokens** (~$0.13 on `gpt-5.4`) because the agent reads files and runs read-only commands across several turns. Codex for Open Source grants, API credits and Pro allowances all run out, and most review bots give you no idea how fast.

`codex-meter` sits in front of the Codex CLI and answers four questions:

1. **Should this pull request spend tokens at all?** Cheap gates run first: drafts, labelled PRs, fork PRs, docs-only diffs, lockfiles and generated files, oversized diffs, and commits that were already reviewed.
2. **How much may this run cost?** Monthly token or dollar budgets and a per-run cap, enforced *before* the call, not after the invoice.
3. **What did it actually cost?** Real `turn.completed` usage is parsed, priced against a published price table and written to an append-only ledger.
4. **Where did the month go?** `codex-meter report` turns the ledger into spend per pull request, skip reasons, cache reuse and findings by severity.

## What it looks like

One comment per pull request, updated in place, followed by the spend it took to produce it:

```markdown
<!-- codex-meter:summary -->
## codex-meter review

Replaces the standalone `upload()` function with a `Uploader` class that adds an authorization header and a retry path for network failures. Not safe to merge: the retry path sends an empty, unauthenticated body in an unbounded loop that ignores `maxAttempts`, so any transient failure turns into a hang that uploads nothing.

Risk: **high** · findings: **2**

| severity | location | finding |
| --- | --- | --- |
| critical | `src/upload.ts:23` | Retry uploads an empty body because `buffer` is never populated _Fix:_ Retry with the same payload: `body: options.body`. |
| high | `src/upload.ts:22` | Unbounded retry loop ignores `maxAttempts` and has no backoff _Fix:_ Bound the loop with `for (let attempt = 0; attempt < options.maxAttempts; attempt++)` and add backoff. |

<sub>codex-meter 0.1.0 · head eeee1a24 · base main · 74s</sub>
<sub>Spend: in 116.6k / cached 104.0k / out 4.6k · estimated $0.1272 · model gpt-5.4</sub>
<sub>Budget: 121.2k / 1.20M tokens this month (10%)</sub>
```

That output comes from a real Codex run against a deliberately broken diff; the test suite replays it as a fixture.

## Quick start (GitHub Actions)

```yaml
name: codex-meter
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: write        # only needed for the durable ledger branch
  pull-requests: write

concurrency:
  group: codex-meter-${{ github.event.pull_request.number }}
  cancel-in-progress: false

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
          persist-credentials: false

      - uses: twoimo/codex-meter@v1
        with:
          api-key: ${{ secrets.OPENAI_API_KEY }}
          budget-tokens: '1200000'   # about ten measured reviews a month
          run-tokens: '900000'       # per-review ceiling, raise it for large diffs
          state: branch              # keep the monthly budget across runs
```

`state: branch` stores the ledger on a `codex-meter-state` branch so the monthly budget survives between workflow runs. With `state: file` the ledger is per-run only: useful for reports, useless for budgets.

## Quick start (CLI)

```bash
npx codex-meter explain --base origin/main    # decide, never spend
npx codex-meter review  --base origin/main    # review, meter, comment
npx codex-meter report  --month 2026-09       # where the month went
```

From a checkout instead of npm:

```bash
npm ci && npm run build
node dist/src/cli.js explain --base origin/main
```

`explain` is the safe way to tune the policy: it prints the decision, the reason, the estimated tokens and the remaining budget without calling Codex.

## Policy gates

Rules are evaluated cheapest-first and the first match wins, so every decision is explainable (`explain` prints the code and the reason).

| decision code | when it fires |
| --- | --- |
| `disabled` | `enabled: false` |
| `draft` | the pull request is a draft |
| `label-skip` | the skip label (default `skip-codex-meter`) is present |
| `fork-pr` | the PR comes from a fork, so your secret is not readable by it |
| `no-changes` | empty diff |
| `docs-only` | only documentation changed |
| `generated-only` | only generated files, lockfiles or binaries changed |
| `too-small` | below `minChangedLines` |
| `too-large` | above `maxChangedLines`, with a message asking for a split |
| `already-reviewed` | the same head commit already has a metered review in the ledger |
| `no-credential` | no API key and no stored Codex login |
| `budget-exhausted` | monthly or per-run token/dollar budget would be exceeded |
| `run` | spend is approved |

## Configuration

Drop a `.codex-meter.json` in the repository root (or `.github/codex-meter.json`). Unknown keys are reported, not silently ignored.

```json
{
  "enabled": true,
  "skipLabel": "skip-codex-meter",
  "allowForkPrs": false,
  "skipDocsOnly": true,
  "skipGeneratedOnly": true,
  "maxChangedLines": 4000,
  "model": "gpt-5.4",
  "budget": {
    "tokensPerMonth": 1200000,
    "tokensPerRun": 400000,
    "usdPerMonth": null
  },
  "state": { "mode": "branch", "branch": "codex-meter-state", "path": ".codex-meter/ledger.jsonl" },
  "comment": "upsert",
  "failOn": "high",
  "ignoreUserConfig": true,
  "pricing": {
    "gpt-5.4": { "input": 2.5, "cachedInput": 0.25, "output": 15 }
  }
}
```

Every option also has a CLI flag (`--budget-tokens`, `--fail-on`, `--state`, `--model`, `--max-changed-lines`, and so on); run `codex-meter help`.

## Budgets and cost accounting

- Token budgets are always available, because the Codex CLI reports real usage.
- Dollar budgets need a price for the model in use. Published rates ship in `src/pricing.ts` with the retrieval date; they are a snapshot, not a quote. Variants such as `gpt-5.4-codex` fall back to the closest published prefix and say so.
- Estimation before the run is a heuristic calibrated on measured runs (see [docs/cost-model.md](docs/cost-model.md)). The numbers that matter are the ones in the ledger, not the estimate.
- Reaching a budget stops reviews until the next month and posts a comment explaining why, instead of failing the pull request.

## Security model

- The API key is stored once through `codex login --with-api-key` inside a **throwaway `CODEX_HOME`**, and removed from the environment of the Codex process. Commands Codex runs in your checkout therefore cannot read it. See [docs/security.md](docs/security.md).
- Fork pull requests are skipped by default. `allowForkPrs` exists, but the secret still is not available to forks, so enabling it only makes sense with a separate low-privilege key.
- Codex runs with `--ephemeral` (no session files) and the CLI's read-only sandbox default. `codex-meter` never edits your repository, never pushes commits and never resolves comments.
- The action needs `pull-requests: write` for the comment and `contents: write` only when `state: branch`. Pass `github-token` if you want a token other than the workflow token.

## What this does not do

- It does not fix code or push commits. It reviews and reports.
- It does not post inline review comments yet; findings arrive as one upserted comment.
- It does not make Codex cheaper per call. It decides when not to call, and shows you what each call cost.
- Prices and token estimates drift as models change; re-check them with `report` after a month of real runs.

`codex-meter` is complementary to [`openai/codex-action`](https://github.com/openai/codex-action), which handles installing Codex, proxying Responses API calls and sandbox strategy. Use that action when you want a plain Codex step; use this one when you need the spend to be bounded and auditable.

## Status

Pre-1.0, and honest about it: the policy engine, budgets, ledger and reporting are covered by 56 tests, CI runs on Node 20 and 22, and CI fails if the committed `dist/` drifts from a fresh build. The review path itself is verified against a recorded Codex session rather than a live call, so the suite stays free and reproducible. `ROADMAP` ideas live at the end of [docs/design.md](docs/design.md).

## Development

```bash
npm ci
npm test          # build + 56 tests, including a recorded-session integration test
npm run explain   # decide on the current diff without spending
```

The integration tests replay a captured Codex session from `test/fixtures/`, so the suite needs no network access, no credentials and no quota.

## License

MIT
