# AGENTS.md

Guidance for coding agents (Codex, Claude Code, and friends) working in this repository.

## Commands

```bash
npm ci                       # install dev dependencies (typescript, @types/node only)
npm run build                # tsc -p tsconfig.json -> dist/
npm test                     # build + node --test on dist/test/
node dist/src/cli.js explain --base HEAD~1 --head HEAD --json   # inspect the policy locally
```

## Constraints

- **Zero runtime dependencies.** The published package and the GitHub Action run on Node 20+ standard library only. Do not add a runtime dependency without an explicit decision recorded in `docs/design.md`.
- **Tests use `node:test`.** No test framework. Integration tests must not need network access or credentials: use `test/fixtures/codex-stub.mjs` to replay a captured session.
- **`dist/` is committed.** The GitHub Action executes `dist/src/cli.js`, so run `npm run build` and include the result in the same commit as any source change. CI checks that `dist` matches a fresh build.
- **TypeScript is strict** with `noUncheckedIndexedAccess`. Do not weaken `tsconfig.json` to silence an error; fix the code.
- Never print, log or commit credentials. The ledger, comments and step summaries must stay free of secrets, diffs and prompts.
- Do not add telemetry, phone-home calls or background jobs.

## Adding a policy gate

1. Add the decision code to `DecisionCode` in `src/types.ts`.
2. Insert the check in `src/policy.ts` in the correct cost order (metadata gates before content gates before budget gates).
3. Write the reason string as a full sentence a maintainer can act on.
4. Add a test in `test/policy.test.ts` and, if the gate can post a comment, extend `SKIP_CODES_WORTH_COMMENTING` in `src/cli.ts` and cover it in `test/review-path.test.ts`.

## Review expectations

- Findings must be reproducible: say which input produces which decision or failure.
- Prefer explicit, boring code over clever abstractions; this tool is read by maintainers who did not write it.
- Keep the README and `docs/` truthful. If behaviour changes, update the document that describes it in the same change.
