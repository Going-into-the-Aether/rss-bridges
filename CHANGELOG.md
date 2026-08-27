# Changelog

## Unreleased

### 2026-08-27

- Added sanitized full article HTML to `content:encoded` while retaining short feed descriptions.
- Added a dry-run-first, URL-idempotent Readwise Reader historical import command with full metadata and rate limiting.

### 2026-08-26

- Added the reusable TypeScript Cloudflare Worker and first Tidings.org adapter.
- Added a January 1, 2025 historical bootstrap, rolling-200 mode, explicit edge caching, partial-source handling, and JSON diagnostics.
- Added Reader-facing RSS metadata including displayed single and multiple authors, excerpts, canonical links, stable GUIDs, publication dates, and images.
- Added a generated historical author index covering all 72 records whose REST content did not expose a reliable byline.
- Added automated unit and live integration coverage, Husky/lint-staged checks, and destructive-git guardrails.
