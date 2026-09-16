# Cost model

Codex review cost is dominated by how many turns the agent takes, not by the size of the diff, so any estimate is a heuristic. This document records the measurements the defaults were calibrated from, and how to replace them with your own.

## Measured runs (2026-09-16, codex-cli 0.153.4, `codex exec --json --ephemeral --output-schema`)

| scenario | input tokens | cached input | output tokens | duration | estimated cost on `gpt-5.4` |
| --- | --- | --- | --- | --- | --- |
| trivial one-turn prompt ("reply PONG") | 18,193 | 0 | 32 | ~3 s | ~$0.046 |
| review of a 23-line diff, 2 findings returned | 116,593 | 103,955 | 4,642 | ~74 s | $0.1272 |

Notes:

- Input tokens include cached tokens. Only the uncached remainder is billed at the full input rate.
- The large cached share is why the second review of a similar diff can be cheaper than the estimate.
- A trivial prompt already costs ~18k input tokens: the system prompt, tool definitions and repository context are not free. There is no such thing as a "cheap" Codex call, which is why the gates come before the call.

## Defaults derived from those numbers

```json
{
  "estimate": {
    "baselineTokens": 100000,
    "tokensPerChangedLine": 1500,
    "outputBaselineTokens": 3000,
    "outputTokensPerChangedLine": 60
  },
  "budget": {
    "tokensPerMonth": 1200000,
    "tokensPerRun": 400000
  }
}
```

`tokensPerMonth: 1200000` is deliberately "about ten measured reviews". It is a starting point for a small project, not a recommendation: raise it once `report` shows what your repository actually costs.

## Pricing

`src/pricing.ts` carries a snapshot of the published rates, tagged with the retrieval date and source URL. It is used for:

- the pre-run estimate (only to compare against `usdPerMonth` / `usdPerRun`),
- the cost recorded in the ledger,
- the `report` output.

Variant names resolve to the closest published prefix (`gpt-5.4-codex` → `gpt-5.4`) and are flagged as approximate, which surfaces as a note in `explain` output. Unknown models report no price at all: the ledger keeps the token counts and marks dollar totals as incomplete rather than inventing a number.

Override prices in `.codex-meter.json` when your contract differs:

```json
{
  "pricing": {
    "gpt-5.4": { "input": 2.5, "cachedInput": 0.25, "output": 15 }
  }
}
```

## Recalibrating

1. Run reviews for a week with `state: branch`.
2. `codex-meter report --month YYYY-MM --format json` and read `averageTokensPerReview`, `cacheHitRatio` and `topSpend`.
3. Update `estimate.*` and `budget.*` from those numbers, not from this document.

The ledger is the source of truth for what was spent. The estimate exists only to stop a run that clearly cannot fit in the remaining budget.
