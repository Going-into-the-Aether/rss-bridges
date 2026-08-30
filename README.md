# RSS Bridges

Reusable Cloudflare Workers that provide standards-compliant RSS feeds for sites whose native feeds are incomplete or unreliable.

The adapters serve Tidings.org and theChristadelphian.com with canonical URLs, defensible bylines, publication dates, images, excerpts, source categories, and sanitized full article bodies. They are designed for RSS readers such as Readwise Reader that may consume either RSS `description` or `content:encoded`.

## Live service

| Route | Purpose |
| --- | --- |
| <https://feeds.atwood.fyi/tidings> | Tidings.org RSS 2.0 feed |
| <https://feeds.atwood.fyi/tidings/status> | Source, extraction, partial-feed, and author-fallback diagnostics |
| <https://feeds.atwood.fyi/the-christadelphian> | Combined The Christadelphian and Faith Alive full-content RSS feed |
| <https://feeds.atwood.fyi/the-christadelphian/status> | Live or relay source, snapshot timestamp, item-count, and author-fallback diagnostics |

The Tidings feed runs in steady-state rolling mode and retains the newest 200 items. Its completed one-time bootstrap covered all articles published on or after January 1, 2025 and was imported directly into Reader's Later library before this cutover. Rolling collection continues into later source pages when cross-source URL deduplication leaves the feed short. Status diagnostics report `underfilled`, `targetItems`, and whether a remaining shortfall came from source exhaustion, a source failure, or the configured page cap. An underfilled rolling result is intentionally `ok: false` and `partial: true`, even when every available source page was fetched successfully.

Author diagnostics report `authorFallbacks`, `authorFallbackThreshold`, `authorFallbackExceeded`, and `unresolvedAuthorUrls`. Production defaults the threshold to zero, so any newly unresolved canonical URL makes status `ok: false` and `partial: true` while the RSS item remains available with the publication-level fallback author. Add a verified canonical author override or improve extraction before raising the threshold.

The theChristadelphian.com adapter initially includes its complete public blog catalog, beginning May 16, 2024. Each item carries either `The Christadelphian` or `Faith Alive` as RSS category metadata. After bootstrap and Reader validation, its steady-state mode also retains the newest 200 items.

## How it works

- `src/adapters/tidings.ts` retrieves Tidings WordPress content and extracts source-specific metadata.
- `src/adapters/the-christadelphian.ts` uses the public WordPress posts API, resolves featured media, preserves the two publication categories, and retains the complete sanitized article body without truncating on editorial headings.
- `scripts/publish-christadelphian-snapshot.sh` refreshes the approved public snapshot on the isolated `data` branch every six hours from the always-on `atlas` host. The Worker uses it only when every direct WordPress endpoint is unavailable to Cloudflare egress.
- `src/rss.ts` serializes the shared feed model as RSS 2.0.
- `src/index.ts` provides Worker routing, diagnostics, and explicit edge caching.
- `src/data/tidings-author-overrides.json` preserves reviewed historical bylines when source markup is insufficient.

The Worker rejects incomplete historical imports, publishes partial-source diagnostics, and uses a shorter cache lifetime for partial responses. Status responses use their own canonical cache keys, so repeated monitoring reuses complete or partial diagnostics without rebuilding the upstream feed on every request. Relay-backed diagnostics identify the raw snapshot endpoint and its `snapshotGeneratedAt` timestamp.

## RSS and Reader behavior

- Canonical article URLs are stable RSS GUIDs.
- Displayed Tidings bylines are emitted as one or more `dc:creator` elements.
- The WordPress service account `fm_dev` is never used as an article author.
- `The Christadelphian Tidings` is used only when no defensible displayed byline is available.
- Sanitized full article HTML is emitted in both item `description` and `content:encoded`. This duplication is intentional: Reader RSS consumes `description`, while other clients commonly prefer `content:encoded`.
- Relative links, image sources, and `srcset` candidates in article bodies are resolved against their publisher's site origin; same-document fragment links remain unchanged.
- Short excerpts remain available to the direct Reader backlog importer as document summaries.
- theChristadelphian.com exposes the generic `The Christadelphian Office` WordPress author for almost every post. The adapter extracts an explicit individual byline only when the article body supplies one and reports generic-author fallbacks in diagnostics.

The one-time historical importer saves documents to Reader's **Later** location. After each accepted save it polls Reader's exact-ID list query with full HTML enabled, verifies the canonical source URL, location, required tags, and non-empty body, and reports retained, rejected, and missing counts separately. Exact-ID reconciliation stays below Reader's 20-list-requests-per-minute limit. Aggregate pagination is not used as completion proof because it can remain stale after bulk operations.

The combined theChristadelphian.com import tags each Reader document with `the-christadelphian`, `historical-import`, and its source category slug (`the-christadelphian` or `faith-alive`).
Use `--limit=3` for the first applied pilot; rerunning without the limit is URL-idempotent and completes the catalog.

## Development

```bash
npm ci
npm test
npm run type-check
npm run lint
npm run format:check
npm run dev
```

Refresh the committed historical author index when Tidings markup changes or diagnostics report new fallbacks:

```bash
npm run sync:tidings-authors
```

Preview the one-time Reader backlog import. Dry-run mode fetches and counts eligible articles but never calls Reader:

```bash
npm run import:tidings-reader
npm run import:christadelphian-reader
```

After reviewing the count, inject `READWISE_TOKEN` at runtime and apply the import:

```bash
READWISE_TOKEN='<runtime-secret>' \
  npm run import:tidings-reader -- --apply --location=later

READWISE_TOKEN='<runtime-secret>' \
  npm run import:christadelphian-reader -- --apply --location=later
```

Do not store the token in the repository or a committed environment file. Reader deduplicates saves by canonical URL. A repeated run reports existing documents separately from newly created documents. The importer defaults to Later and stays below Reader's save and exact-list rate limits. Reader saves retry HTTP 429 and transient 5xx responses with bounded exponential backoff, honor `Retry-After`, and report the canonical article URL on permanent or exhausted failures. An applied import exits nonzero if any save fails or any accepted document is rejected or remains missing after reconciliation.

## Deployment

```bash
npm run deploy
```

Wrangler owns the `feeds.atwood.fyi` custom domain. No application secrets are required.
The committed author index is used by default; synchronous page-level author fallback requests are disabled in production.

Before deploying, run:

```bash
npm test
npm run type-check
npm run lint
npm run format:check
npx wrangler deploy --dry-run
```

## Repository hygiene

Local agent configuration, GitHub/AetherOS templates, Husky hooks, editor state, Wrangler state, credentials, and operator notes are intentionally ignored. Portable project configuration such as `.gitattributes`, `.gitignore`, ESLint, Prettier, TypeScript, Vitest, Wrangler configuration, and the generic launchd template remains versioned for reproducible development.

## Snapshot operations

The publisher blocks Cloudflare Worker and GitHub-hosted runner networks. The `atlas` LaunchAgent renders `ops/launchd/ai.aetheros.rss-bridges-snapshot.plist`, runs at load and every 21,600 seconds, and calls:

```bash
npm run snapshot:christadelphian -- --output=<temporary-path>
```

The publisher script validates the minimum catalog size and unique IDs, updates only the orphan `data` branch, signs its commit, and pushes through UAH's supervised Git wrapper. Install dependencies once with `npm ci`; no secret is stored in this repository.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities. Never commit API tokens, `.dev.vars`, `.env` files, or generated local-agent context.
