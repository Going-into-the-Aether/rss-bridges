# RSS Bridges

**Status:** Active | **Domain:** Content / Infrastructure

Reusable Cloudflare RSS bridges for sites whose native feeds do not expose current content or reliable metadata. Tidings.org is the first source adapter.

## Agent Entry Point

- Local manifest: `_rss-bridges-MANIFEST.md`
- Agent guide: `AGENT.md`
- Tracking: [rss-bridges #1](https://github.com/Going-into-the-Aether/rss-bridges/issues/1)

## Routes

| Route                                     | Purpose                                |
| ----------------------------------------- | -------------------------------------- |
| `https://feeds.atwood.fyi/tidings`        | RSS 2.0 feed for Tidings.org           |
| `https://feeds.atwood.fyi/tidings/status` | Live source and extraction diagnostics |

The initial deployment runs in bootstrap mode and includes content published from January 1, 2025 onward. After Readwise Reader confirms the historical import, the same URL will switch to the newest 200 items.

## Development

```bash
npm install
npm test
npm run type-check
npm run lint
npm run dev
```

Refresh the committed historical author index when Tidings markup changes or diagnostics report new fallbacks:

```bash
npm run sync:tidings-authors
```

Preview the one-time Reader backlog import. Dry-run mode fetches and counts eligible articles but never calls Reader:

```bash
npm run import:tidings-reader
```

After reviewing the count, run the idempotent import through the supervised Readwise token profile:

```bash
op run --env-file=~/Developer/UAH/vault/env/readwise-assistant.env.op -- \
  npm run import:tidings-reader -- --apply --location=later
```

Reader deduplicates saves by canonical URL. A repeated run reports existing documents separately from newly created documents. The importer defaults historical documents to Later and stays below Reader's 50-save-per-minute limit.

## Deployment

```bash
npm run deploy
```

Wrangler owns the `feeds.atwood.fyi` custom domain. No application secrets are required.
The committed author index is used by default; synchronous page-level author fallback requests are disabled in production.

## Metadata policy

- Use the displayed Tidings byline, including multiple authors.
- Never publish the WordPress service account `fm_dev` as an article author.
- Fall back to `The Christadelphian Tidings` only when no defensible byline can be extracted.
- Emit sanitized full article HTML in both item `description` and `content:encoded`; Reader RSS consumes `description`, while other clients commonly prefer `content:encoded`.
