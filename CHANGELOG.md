# Changelog

## Unreleased

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
