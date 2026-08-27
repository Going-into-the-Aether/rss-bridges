# RSS Bridges Repository Note

- **Created:** 2026-08-26
- **Status:** active
- **Objective:** Host reusable, metadata-rich RSS bridges on Cloudflare, beginning with Tidings.org for Readwise Reader.

## Key files and links

- Repository: https://github.com/Going-into-the-Aether/rss-bridges
- Tracking issue: https://github.com/Going-into-the-Aether/rss-bridges/issues/1
- Working directory: `/Users/chris/Developer/Repositories/Going-into-the-Aether/rss-bridges`
- Local manifest: `_rss-bridges-MANIFEST.md`
- Public feed: https://feeds.atwood.fyi/tidings

## Current phase

The Tidings adapter is deployed in historical bootstrap mode for content published from January 1, 2025 onward. Issue #7 adds full-content RSS output and a one-time idempotent Reader import path because Reader subscriptions only load the five newest existing items. Keep bootstrap mode active until Chris validates full article bodies and the historical import.
