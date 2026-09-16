# Contributing

Thanks for considering a contribution. This project is small on purpose: it decides when Codex should spend tokens, and it reports what was spent.

## Setup

```bash
npm ci
npm test
```

Node 20 or newer. There are no runtime dependencies, and adding one needs a documented reason in `docs/design.md`.

## What is most useful

- **Policy gates** for change types that waste spend (vendored code, generated clients, translation files, snapshots).
- **Cost accuracy**: price tables, model name variants, token accounting edge cases.
- **Report output** that maintainers can read at a glance.
- **Failure handling** for real CI conditions: missing keys, quota and usage-limit errors, timeouts, huge diffs.

## Ground rules

- Every behaviour change comes with a test. Integration tests replay `test/fixtures/codex-stub.mjs`, so they run without network access, credentials or quota.
- Keep `dist/` in sync: `npm run build` and commit the output with the source change. CI verifies this.
- Do not introduce a runtime dependency, a telemetry call, or anything that mutates a repository under review.
- Never include credentials in tests, fixtures or logs.
- Update `README.md`, `README.ko.md` and the relevant file under `docs/` when behaviour or configuration changes.

## Pull request checklist

- [ ] `npm test` passes locally.
- [ ] `dist/` matches a fresh build.
- [ ] New decision codes have a test and an actionable reason string.
- [ ] Documentation updated where the behaviour is described.
- [ ] No secrets, diffs or prompts end up in the ledger, comments or step summaries.

## Reporting a security issue

See [SECURITY.md](SECURITY.md). Please do not open a public issue for credential handling or sandbox concerns.
