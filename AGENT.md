# Agent Entry Point

## Objective
<!-- What this project does — one paragraph -->

## Stack
<!-- Languages, key libraries, external services -->

## Key Rules
- Zero-plaintext secrets — use `op run` or service account injection
- Follow workspace `.gitignore` conventions — never commit CLAUDE.md, CODEX.md, GEMINI.md, `_*-MANIFEST.md`
- Run `--dry-run` before any batch mutation

## Entry Points
| Script / File | Purpose |
|---|---|
| <!-- add rows --> | |

## Do Not
- Commit secrets or generated AI context files
- Rename `CLAUDE.md`, `CODEX.md`, `GEMINI.md`, or `AGENT.md` (mechanical integrity rule)
- Push directly to `main` without a PR
