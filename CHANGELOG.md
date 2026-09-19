# Changelog

All notable changes to this project. Versions follow `major.minor.patch`, and the `v1` tag tracks the latest compatible release.

## 0.1.3

### Added

- **Opt-in label gate (`requireLabel`).** When set, only pull requests carrying that label are reviewed; everything else is skipped as `label-missing` with an actionable reason and no comment. Off by default (`requireLabel: null`). The skip label still wins over the opt-in label. Placed after `label-skip` and before `fork-pr` in the documented order.

### Changed

- GitHub Action and CI now use `actions/checkout@v7` and `actions/setup-node@v7`.
- The action-manifest test accepts any `actions/setup-node@vN` major version, so Dependabot bumps no longer fail a hardcoded pin.
- Dev toolchain: TypeScript 7 and `@types/node` 26. The committed `dist/` was rebuilt to match.
- Dependabot weekly grouped npm updates and monthly action updates, plus the release procedure in `AGENTS.md`.

## 0.1.2

### Added

- **Bot-author gate.** Pull requests authored by automation are skipped before any spend. Detection uses GitHub's `[bot]` convention, `app/<slug>` identities, and a short list of known accounts, and can be turned off with `skipBotAuthors: false`. Gate precedence (`draft` -> `bot-author` -> `label-skip` -> `fork-pr`) is pinned by a test that stacks every condition on one pull request.
- **Custom Codex providers.** A `provider` block points a review at an OpenAI-compatible gateway instead of OpenAI itself: the OpenAI login is skipped, the settings are passed as explicit `-c model_providers...` overrides, and the provider's environment variable counts as the credential. `wireApi` defaults to `responses` because current Codex CLI versions reject `wire_api = "chat"`.

### Notes

- A generic `-bot` suffix rule was removed during review: a human can own a handle like `some-bot`, and silently skipping a human contribution is worse than reviewing one bot pull request.
- Gateways that route per client, such as OpenCode Go which requires an `x-opencode-session` header, cannot back a Codex run; the README records the probe so nobody repeats it.

## 0.1.1

### Fixed

- The action manifest did not load: an unquoted colon in `action.yml`'s description made GitHub reject it with `Mapping values are not allowed in this context`. The released 0.1.0 action was unusable.
- The review comment was silently skipped because the action relied on `GITHUB_TOKEN` being present in the environment. The action now takes a `github-token` input defaulting to the workflow token, and reports `comment: created|updated` or a warning naming `pull-requests: write`.
- Added manifest validation to CI (`test/action-manifest.test.ts`) covering `action.yml` and both workflow files, so a manifest that GitHub would refuse fails the build instead.

### Added

- `run-tokens` input, so repositories with large diffs can raise the per-review ceiling instead of being skipped by the default.

## 0.1.0

### Added

- Ordered policy gates that run before any Codex call: drafts, labelled pull requests, fork pull requests, docs-only diffs, lockfiles and generated files, oversized diffs, and head commits that were already reviewed.
- Monthly token and dollar budgets plus a per-run cap, enforced before the call and recorded in an append-only ledger.
- Real `turn.completed` usage parsed and priced from a published price table, with the source and retrieval date recorded in `src/pricing.ts`.
- One upserted pull request comment carrying the findings and the spend that produced them.
- `codex-meter explain` (decide without spending), `review`, and `report` (spend, skips, cache reuse).
- Zero runtime dependencies, and integration tests that replay a recorded Codex session.
