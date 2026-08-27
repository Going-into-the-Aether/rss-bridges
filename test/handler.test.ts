import { describe, expect, it, vi } from "vitest";
import { handleRequest, tidingsOptions } from "../src/index";

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
  it("disables synchronous author-page fallbacks by default", () => {
    expect(tidingsOptions({}).pageFallbackLimit).toBe(0);
    expect(tidingsOptions({ TIDINGS_PAGE_FALLBACK_LIMIT: "2" }).pageFallbackLimit).toBe(2);
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
});
