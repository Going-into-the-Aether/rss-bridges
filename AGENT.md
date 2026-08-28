# Agent Entry Point

## Objective

Provide stable, metadata-rich RSS endpoints through one reusable Cloudflare Worker. Each source-specific adapter retrieves canonical content and maps it into a shared feed model. Tidings.org is the first adapter.

## Stack

- TypeScript
- Cloudflare Workers and Wrangler
- Vitest
- ESLint and Prettier

## Key Rules

- Zero-plaintext secrets. This Worker currently needs no secrets.
- Keep source-specific parsing inside `src/adapters/`.
- Keep RSS generation and XML escaping source-agnostic.
- Do not emit a source CMS account as an article author.
- Do not remove the bootstrap mode until Chris confirms the historical Reader import.
- Never push directly to `main`; use a pull request.
- Keep local harness configuration, editor state, and operator notes out of the public repository.

## Entry Points

| Script / File             | Purpose                                               |
| ------------------------- | ----------------------------------------------------- |
| `src/index.ts`            | HTTP routing and edge-cache behavior                  |
| `src/adapters/tidings.ts` | Tidings WordPress retrieval and metadata extraction   |
| `src/rss.ts`              | RSS 2.0 serialization                                 |
| `wrangler.jsonc`          | Cloudflare deployment and custom-domain configuration |

## Linked AetherOS skills

- Cloudflare
- Cloudflare Workers Best Practices
- Wrangler
- Read the Damn Docs
- Verification Gate

## Do Not

- Commit secrets or generated AI context files.
- Rename `AGENT.md`.
- Use the legacy Tidings RSS feed as an upstream source.
- Treat `fm_dev` as an article byline.
- Remove failed-author diagnostics to make the status endpoint appear healthier.
