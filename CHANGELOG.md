# Changelog

## Unreleased

### 2026-10-18

- Resolved visible Tidings bylines for split italic signatures and CBMA role signatures, so recent items no longer fall back to the publication author and the feed health check reports ok.
- Added verified exact-URL bylines for four items signed only with a closing italic name, and for two collective pages. A closing italic line alone is never taken as an author, because it cannot be told apart from a publication title.
- Let an empty author override mark a reviewed page with no byline as exempt from author health failures.

### 2026-10-12

Relates to Going-into-the-Aether/UAH#2644.

- Added a stable CalVer milestone policy while preserving package scaffolding and separate data snapshot publications.
- Added uncached `/build-info.json` source and Cloudflare version identity without authentication, feed retrieval, or cache access.
- Generate ignored build provenance through Wrangler's custom build, report local dirty sources truthfully, and reject Git failures or dirty release preparation.
- Added provenance and endpoint tests plus release evidence, inspection, and recovery instructions.

### 2026-08-30

- Routed unattended snapshot commits through an explicit caller-supplied signing wrapper so scheduled publication does not depend on an interactive signing agent.
- Removed the deleted operator note from reachable public branch history and retired stale topic branches that retained it.
- Removed the scheduled snapshot job's credential dependency for public data-branch fetches while retaining bounded execution and supervised pushes.

### 2026-08-29

- Reconcile every accepted Reader save by exact document ID and report retained, rejected, and missing outcomes without trusting stale aggregate pagination.
- Resolve relative article-body links and image candidates against the publisher origin, preserve fragment links, and add bounded Reader save retries with canonical-URL failure reporting.
- Report unresolved Tidings author URLs and mark diagnostics partial when publication-level fallbacks exceed the configured threshold.
- Strip XML 1.0-forbidden control characters from RSS text and full-content CDATA while preserving valid Unicode.
- Detect rolling Tidings underfill after cross-source deduplication, fetch additional pages when available, and report why the configured target still cannot be reached.
- Bounded scheduled snapshot Git operations and terminate their complete process groups when secret-backed transport hangs.
- Transitioned the Tidings production feed from its completed January 2025 bootstrap to the newest 200 rolling items.
- Cached feed diagnostics under canonical status keys to prevent monitoring traffic from amplifying upstream requests.

### 2026-08-28

- Added WordPress REST endpoint failover when Cloudflare Worker egress receives an HTML interception response.
- Added an approved six-hour GitHub data-branch relay for Cloudflare environments blocked by the publisher origin.
- Moved snapshot refresh execution to a scheduled macOS host after GitHub-hosted runners also received HTTP 403 from the publisher.

### 2026-08-27

- Added a combined full-content theChristadelphian.com blog adapter with The Christadelphian/Faith Alive source categories, complete public backlog bootstrap, featured images, safe author fallback diagnostics, and a Reader Later importer.
- Deployed the Tidings adapter to `feeds.atwood.fyi` with 283 bootstrap items and zero author fallbacks.
- Added sanitized full article HTML to both RSS item `description` and `content:encoded` for Reader compatibility.
- Added a dry-run-first, URL-idempotent Readwise Reader historical importer with full metadata, rate limiting, and Later as its default destination.
- Reconciled the historical import to all 283 canonical URLs and documented Reader's stale-pagination limitation.
- Removed local agent, automation-template, and Git-hook configuration from public tracking. Retained portable formatting and repository configuration.

### 2026-08-26

- Added the reusable TypeScript Cloudflare Worker and first Tidings.org adapter.
- Added a January 1, 2025 historical bootstrap, rolling-200 mode, explicit edge caching, partial-source handling, and JSON diagnostics.
- Added Reader-facing RSS metadata including displayed single and multiple authors, excerpts, canonical links, stable GUIDs, publication dates, and images.
- Added a generated historical author index covering all 72 records whose REST content did not expose a reliable byline.
- Added automated unit and live integration coverage, Husky/lint-staged checks, and destructive-git guardrails.
