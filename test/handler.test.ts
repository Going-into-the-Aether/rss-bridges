import { describe, expect, it, vi } from "vitest";
import { christadelphianOptions, handleRequest, tidingsOptions } from "../src/index";

class MemoryCache {
  readonly values = new Map<string, Response>();

  async match(request: Request): Promise<Response | undefined> {
    return this.values.get(request.url)?.clone();
  }

  async put(request: Request, response: Response): Promise<void> {
    this.values.set(request.url, response.clone());
  }
}

describe("HTTP routing", () => {
  it("defaults the Tidings feed to the newest 200 rolling items", () => {
    expect(tidingsOptions({})).toEqual({
      mode: "rolling",
      bootstrapAfter: "2025-01-01T00:00:00Z",
      rollingLimit: 200,
      pageFallbackLimit: 0,
    });
  });

  it("disables synchronous author-page fallbacks by default", () => {
    expect(tidingsOptions({}).pageFallbackLimit).toBe(0);
    expect(tidingsOptions({ TIDINGS_PAGE_FALLBACK_LIMIT: "2" }).pageFallbackLimit).toBe(2);
  });

  it("defaults the Christadelphian feed to the complete bootstrap and rolling 200", () => {
    expect(christadelphianOptions({})).toEqual({
      mode: "bootstrap",
      bootstrapAfter: "2024-01-01T00:00:00Z",
      rollingLimit: 200,
    });
    expect(
      christadelphianOptions({
        CHRISTADELPHIAN_MODE: "rolling",
        CHRISTADELPHIAN_ROLLING_LIMIT: "75",
      }),
    ).toMatchObject({ mode: "rolling", rollingLimit: 75 });
  });

  it("returns 404 and 405 without touching upstream sources", async () => {
    const ctx = { waitUntil: vi.fn() };
    const cache = new MemoryCache();
    const missing = await handleRequest(
      new Request("https://feeds.atwood.fyi/missing"),
      {},
      ctx,
      cache,
    );
    const disallowed = await handleRequest(
      new Request("https://feeds.atwood.fyi/tidings", { method: "POST" }),
      {},
      ctx,
      cache,
    );
    expect(missing.status).toBe(404);
    expect(disallowed.status).toBe(405);
  });

  it("serves a cached feed without regeneration", async () => {
    const cache = new MemoryCache();
    const key = new Request("https://feeds.atwood.fyi/tidings");
    await cache.put(
      key,
      new Response("cached xml", {
        headers: { "Content-Type": "application/rss+xml; charset=UTF-8" },
      }),
    );
    const response = await handleRequest(key, {}, { waitUntil: vi.fn() }, cache);
    expect(await response.text()).toBe("cached xml");
    expect(response.headers.get("X-RSS-Bridge-Cache")).toBe("HIT");
  });

  it("reuses cached Tidings diagnostics across repeated status requests", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("[]", {
          headers: {
            "Content-Type": "application/json; charset=UTF-8",
            "X-WP-TotalPages": "1",
          },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const cache = new MemoryCache();
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (promise: Promise<unknown>) => pending.push(promise) };
    const request = new Request("https://feeds.atwood.fyi/tidings/status");

    const first = await handleRequest(request, {}, ctx, cache);
    await Promise.all(pending);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const second = await handleRequest(request, {}, ctx, cache);

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, cacheStatus: "MISS" });
    expect(await second.json()).toMatchObject({ ok: true, cacheStatus: "HIT" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("reuses cached Christadelphian diagnostics without another snapshot request", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("[]", {
          headers: {
            "Content-Type": "application/json; charset=UTF-8",
            "X-WP-TotalPages": "1",
          },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const cache = new MemoryCache();
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (promise: Promise<unknown>) => pending.push(promise) };
    const request = new Request("https://feeds.atwood.fyi/the-christadelphian/status");

    const first = await handleRequest(request, {}, ctx, cache);
    await Promise.all(pending);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const second = await handleRequest(request, {}, ctx, cache);

    expect(await first.json()).toMatchObject({ ok: true, cacheStatus: "MISS" });
    expect(await second.json()).toMatchObject({ ok: true, cacheStatus: "HIT" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("serves the combined Christadelphian route from its own cache key", async () => {
    const cache = new MemoryCache();
    const key = new Request("https://feeds.atwood.fyi/the-christadelphian");
    await cache.put(
      key,
      new Response("cached combined xml", {
        headers: { "Content-Type": "application/rss+xml; charset=UTF-8" },
      }),
    );
    const response = await handleRequest(key, {}, { waitUntil: vi.fn() }, cache);
    expect(await response.text()).toBe("cached combined xml");
    expect(response.headers.get("X-RSS-Bridge-Cache")).toBe("HIT");
  });

  it("generates the combined Christadelphian feed with source category and full body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                id: 1,
                date_gmt: "2026-08-18T13:00:10",
                modified_gmt: "2026-08-18T13:10:10",
                link: "https://thechristadelphian.com/blog/faith-alive/called-by-name/",
                title: { rendered: "Called by name" },
                excerpt: { rendered: "<p>Short summary.</p>" },
                content: { rendered: "<p>The complete article body.</p>" },
                featured_media: 2,
                categories: [1301],
                _embedded: {
                  "wp:featuredmedia": [
                    { id: 2, source_url: "https://thechristadelphian.com/image.jpg" },
                  ],
                },
              },
            ]),
            {
              headers: {
                "Content-Type": "application/json; charset=UTF-8",
                "X-WP-TotalPages": "1",
              },
            },
          ),
      ),
    );
    const response = await handleRequest(
      new Request("https://feeds.atwood.fyi/the-christadelphian"),
      {},
      { waitUntil: vi.fn() },
      new MemoryCache(),
    );
    const xml = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("X-RSS-Bridge-Items")).toBe("1");
    expect(xml).toContain("<category>Faith Alive</category>");
    expect(xml).toContain("<description><![CDATA[<p>The complete article body.</p>]]>");
    expect(xml).toContain("<content:encoded><![CDATA[<p>The complete article body.</p>]]>");
    vi.unstubAllGlobals();
  });
});
