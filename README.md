# RSS Bridges

Reusable Cloudflare Workers that provide standards-compliant RSS feeds for sites whose native feeds are incomplete or unreliable.

The adapters serve Tidings.org and theChristadelphian.com with canonical URLs, defensible bylines, publication dates, images, excerpts, source categories, and sanitized full article bodies. They are designed for RSS readers such as Readwise Reader that may consume either RSS `description` or `content:encoded`.

## Live service

| Route | Purpose |
| --- | --- |
| <https://feeds.atwood.fyi/build-info.json> | Uncached Worker source, build, release, and Cloudflare version identity |
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
- `scripts/publish-christadelphian-snapshot.sh` refreshes the approved public snapshot on the isolated `data` branch every six hours from a scheduled macOS host. The Worker uses it only when every direct WordPress endpoint is unavailable to Cloudflare egress.
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

## Release and build identity

`.release-policy.json` uses schema 1 for `Going-into-the-Aether/rss-bridges`.
Stable releases are deliberate CalVer milestones. Tags use `vYYYY.M.N`, with
a four-digit year, month 1 through 12, and a positive milestone number starting
at 1 each month. Do not pad month or milestone numbers. Choose the milestone
only when preparing an approved release. `package.json` version `0.1.0` remains
package scaffolding. Snapshot publications on the orphan `data` branch are
separate data updates and do not allocate Worker release versions.

Wrangler's custom build runs `node scripts/generate-build-info.ts` for both
`npm run deploy` and direct `npx wrangler deploy`. It also runs for local dev
and deploy dry-runs. The generated `src/generated/build-info.ts` is ignored,
so generation does not dirty its own source. Do not commit it or bypass the
custom build with `--no-build`. Git failures stop the build. Normal local
builds can report dirty sources truthfully, including untracked files.

`GET /build-info.json` requires no authentication and performs no feed fetch
or cache access. It returns `Cache-Control: no-store` and these fields:

- `schema_version`: 1.
- `source_commit`: full 40-character source SHA.
- `source_dirty`: whether tracked or untracked source changes were present.
- `built_at`: UTC generation time, not deployment time.
- `build_id`: the full source SHA. Rebuilds of the same source share this ID.
- `release_version`: CalVer without `v`, only when clean HEAD has exactly one
  valid milestone tag. Ancestor or unrelated tags never supply this value.
- `cloudflare`: `id`, `tag`, and `timestamp` from the runtime's
  [`CF_VERSION_METADATA` binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/).
  Its timestamp is the Worker version creation time. Its tag is Cloudflare's
  version tag and does not prove Git tag identity.

Missing metadata is `null`, including unknown dirty state. Tests use a safe
unknown source module even when a previous generated file exists. Type-checks
work before generation. Wrangler local dev generates measured source metadata;
runtime metadata may differ from production. A dirty build's SHA identifies
its base commit, not its uncommitted contents. Use the dirty flag and Cloudflare
version ID together to avoid claiming identical artifacts from a shared SHA.

### Release gate

Keep the release behavior and its `CHANGELOG.md` entry in the same PR.
Relates to Going-into-the-Aether/UAH#2644.

After the reviewed changes are committed, prepare from a clean checkout of
the exact candidate source. An untagged candidate reports a null release version.
An authorized exact release tag supplies the version on a subsequent build. Run the checks in Deployment,
then run:

```bash
npm run release:prepare
RSS_BRIDGES_RELEASE=1 npx wrangler deploy --dry-run
git rev-parse HEAD
git status --porcelain --untracked-files=all
git tag --points-at HEAD
```

Strict preparation refuses dirty or ambiguous sources. It permits clean
untagged candidates without claiming a release version. Set
`RSS_BRIDGES_RELEASE=1` on the separately authorized deployment too, so its
custom build repeats the gate. Neither preparation nor dry-run creates tags,
commits, releases, or deployments. No tracked generated file reserves a version.

After an authorized deployment, inspect without fetching a feed:

```bash
curl --fail --silent --show-error -i https://feeds.atwood.fyi/build-info.json
npx wrangler deployments list
npx wrangler versions view <cloudflare-version-id>
git rev-parse 'vYYYY.M.N^{commit}'
```

Retain the clean source result, exact tag and peeled commit, relevant check
results, live response and its `no-store` header, and the matching Cloudflare
version ID as release evidence. The live SHA/build ID must equal the tag's
commit, `source_dirty` must be false, and `release_version`, when present, must match the tag. A null version on a
pre-tag deployment needs a separate verified remote tag-to-live-SHA mapping;
it is not inferred from the latest historical tag.
A dry-run cannot prove which version serves production. During a gradual
rollout, inspect each serving version and record the deployment state.

### Recovery

If identity is missing or mismatched, stop release verification. Confirm the
checkout and exact tags, rerun strict preparation, and inspect the Cloudflare
deployment before taking another action. Never fill unknown values from the
latest historical tag or assume package scaffolding is a release version.
For an authorized recovery, select a previously verified Cloudflare version
through the deployment controls or rebuild its clean tagged source. Inspect
the live endpoint again and retain the recovered version ID. A rebuild can
share a build ID while having a new generation time and Cloudflare version ID.

## Repository hygiene

Local agent configuration, automation templates, Git hooks, editor state, Wrangler state, credentials, and operator notes are intentionally ignored. Portable project configuration such as `.gitattributes`, `.gitignore`, ESLint, Prettier, TypeScript, Vitest, Wrangler configuration, and the generic launchd template remains versioned for reproducible development.

## Snapshot operations

The publisher blocks Cloudflare Worker and GitHub-hosted runner networks. A macOS LaunchAgent rendered from `ops/launchd/org.rss-bridges.snapshot.plist` runs at load and every 21,600 seconds, and calls:

```bash
npm run snapshot:christadelphian -- --output=<temporary-path>
```

The publisher script validates the minimum catalog size and unique IDs. It fetches the public `data` branch without credentials and within the configured timeout. It updates only that orphan branch and signs its commit.

The script uses a caller-supplied commit wrapper to create and verify signed snapshot commits. It uses the caller-supplied supervised Git wrapper only when changed content requires a push. Replace `__REPO_ROOT__`, `__LOG_DIR__`, `__GIT_WRAPPER__`, and `__COMMIT_WRAPPER__` in the LaunchAgent template during installation. Both wrappers must be executable. Install dependencies once with `npm ci`. This repository stores no secret or operator-specific path.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities. Never commit API tokens, `.dev.vars`, `.env` files, or generated local-agent context.
