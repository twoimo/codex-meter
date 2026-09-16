# Security policy

## Reporting a vulnerability

Open a private report through GitHub Security Advisories ("Report a vulnerability" on the repository's Security tab). Do not open a public issue for anything involving credential exposure, sandbox escapes or untrusted-input handling.

Please include: the affected version, the smallest reproduction, and what an attacker gains. Expect an initial response within a week.

## Scope

In scope:

- Credential handling: a path where an API key becomes readable by code in the reviewed repository, appears in logs, or is written to the ledger, comment or step summary.
- Sandbox and permission mistakes: running Codex with write access, bypassing approvals, or writing to a repository under review.
- Prompt-injection consequences: cases where content in a diff leads the tool to take an action rather than produce a finding (the tool never runs commands suggested by the model, never commits and never merges).
- Privilege mistakes in the GitHub integration (comment posting, state branch writes).

Out of scope:

- The quality or accuracy of Codex's findings. Reviews are one reviewer's opinion, and the comment says so.
- Spending the configured budget. That is the tool doing its job; tune `budget.*` if the defaults are wrong for your project.
- Third-party actions or the Codex CLI itself. Report those upstream.

The design is described in [docs/security.md](docs/security.md).
