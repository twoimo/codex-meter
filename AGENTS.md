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

## Releases

1. Bump the version in `package.json`, then `npm run build && npm test` (the committed `dist/` must match a fresh build).
2. Commit as `release: X.Y.Z`, push to `main`.
3. Tag and publish:

   ```bash
   git tag vX.Y.Z && git tag -f v1
   git push origin vX.Y.Z && git push -f origin v1
   gh release create vX.Y.Z --title "codex-meter vX.Y.Z" --notes-file <notes>
   ```

   `v1` is the moving major alias that `uses: twoimo/codex-meter@v1` resolves to; force-pushing it is the only allowed tag rewrite.
4. npm, with the token from the vault (`npm.twoimo`):

   ```bash
   umask 077; printf '//registry.npmjs.org/:_authToken=%s\n' "$(tkt get npm.twoimo)" > /tmp/.npmrc-pub
   NPM_CONFIG_USERCONFIG=/tmp/.npmrc-pub npm publish --access public
   rm -f /tmp/.npmrc-pub
   ```

   The unscoped name `codex-meter` is rejected by npm as too similar to `codexmeter`, so the package stays scoped. The current token expires 2026-09-23 and bypass-2FA publishing is being retired in January 2027: enable 2FA on the npm account and publish with an OTP, or move to staged publishing, before then.

## Repository maintenance

- `main` is protected: no force-push, no deletion, and the CI checks `test (20)` and `test (22)` must pass. `enforce_admins` is off so the owner can still push a release commit directly.
- Dependabot opens grouped dev-dependency PRs weekly and action updates monthly. Bot-authored pull requests are skipped by the dogfood review by design (the `bot-author` gate), so they cost no tokens. CI still runs on them.
- If a dependency bump changes the build output, the pull request also needs `npm run build` and the regenerated `dist/` committed, or CI fails on purpose.
- Secrets: repository secret `OPENAI_API_KEY` (dogfood reviews), vault entry `npm.twoimo` (publishing). Never put either in a workflow `env:` block at job level.
- Never commit `.codex-meter/` (the ledger) or any `.env`.

## Adding a policy gate

1. Add the decision code to `DecisionCode` in `src/types.ts`.
2. Insert the check in `src/policy.ts` in the correct cost order (metadata gates before content gates before budget gates).
3. Write the reason string as a full sentence a maintainer can act on.
4. Add a test in `test/policy.test.ts` and, if the gate can post a comment, extend `SKIP_CODES_WORTH_COMMENTING` in `src/cli.ts` and cover it in `test/review-path.test.ts`.

## Review expectations

- Findings must be reproducible: say which input produces which decision or failure.
- Prefer explicit, boring code over clever abstractions; this tool is read by maintainers who did not write it.
- Keep the README and `docs/` truthful. If behaviour changes, update the document that describes it in the same change.
