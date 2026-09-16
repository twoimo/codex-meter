# Security model

`codex-meter` handles an OpenAI credential inside CI jobs that check out contributor code, so the handling rules are explicit.

## Credential handling

The Codex CLI is invoked as a child process. Two paths exist:

1. **API key (default in CI).** The key is read from `CODEX_API_KEY`/`OPENAI_API_KEY` *in the `codex-meter` process only*, piped to `codex login --with-api-key` with a throwaway `CODEX_HOME` in the system temp directory, and then removed from the environment handed to the Codex process. Codex and any command it runs see a `CODEX_HOME` containing `auth.json`, not an environment variable.
2. **Existing CLI login (local use).** If no key is present, the user's own `CODEX_HOME` is used as-is.

The throwaway home is deleted when the run finishes. The key is never written to the ledger, the comment, the step summary or stdout.

The OpenAI documentation warns that `OPENAI_API_KEY`/`CODEX_API_KEY` must not be set as job-level environment variables in workflows that check out repository-controlled code, because build scripts and tests in the same job can read them. `codex-meter` follows that guidance: in [action.yml](../action.yml) the key is passed to the single step that needs it, and the tool removes it from the child environment.

## Fork pull requests

Fork pull requests are skipped by default (`allowForkPrs: false`). A fork cannot read repository secrets, so running a review for a fork means either the key is unavailable (the run fails) or the workflow has been configured to expose it (a real leak). The skip is recorded in the ledger and, when the pull request looks actionable, explained in a comment.

If you enable `allowForkPrs`, you must accept the risk of spending a key that a fork may be able to influence.

## Sandbox and permissions

- `--ephemeral`: no session rollout files are written.
- The CLI's read-only sandbox is used by default. `codex-meter` does not pass `--dangerously-bypass-approvals-and-sandbox`.
- `--ignore-user-config` is on by default in CI so the run does not inherit a maintainer's local providers, MCP servers or model defaults. Use `--respect-user-config` to opt out.
- The tool never pushes, commits, merges or edits files in the repository.
- GitHub permissions used: `pull-requests: write` (one comment), `contents: read` normally, `contents: write` only for `state: branch`.

## Prompt injection

The diff under review is untrusted input: a contributor can write text that tries to influence the model. Mitigations in place:

- Codex runs read-only; it cannot push or edit the repository from this tool's path.
- The review output is parsed against a fixed JSON schema, and malformed findings are dropped rather than executed or interpreted.
- Findings are rendered as data (escaped table cells) inside one comment; the tool never runs commands suggested by the model.
- Reviewing is not approving: findings never auto-approve, auto-merge or dismiss human review.

Residual risk: a sufficiently strong injection can still produce misleading findings. Treat the review as one reviewer's opinion, which is how the comment is worded.
