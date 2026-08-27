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

## Deployment

```bash
npm run deploy
```

Wrangler owns the `feeds.atwood.fyi` custom domain. No application secrets are required.

## Metadata policy

- Use the displayed Tidings byline, including multiple authors.
- Never publish the WordPress service account `fm_dev` as an article author.
- Fall back to `The Christadelphian Tidings` only when no defensible byline can be extracted.
- Prefer a clean excerpt so Reader can parse the canonical article page for full content.
