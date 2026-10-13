import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildInfo } from "../src/build-info";
import { handleRequest } from "../src/index";

describe("build info endpoint", () => {
  const fetcher = vi.fn(() => {
    throw new Error("Build info must not fetch feeds.");
  });
  const ctx = { waitUntil: vi.fn() };

  beforeEach(() => {
    Object.assign(buildInfo, {
      schema_version: 1,
      source_commit: null,
      source_dirty: null,
      built_at: null,
      build_id: null,
      release_version: null,
    });
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal(
      "caches",
      new Proxy(
        {},
        {
          get: () => {
            throw new Error("Build info must not access caches.");
          },
        },
      ),
    );
  });

  afterEach(() => {
    expect(fetcher).not.toHaveBeenCalled();
    expect(ctx.waitUntil).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("serves unknown metadata without auth, network, or even a default cache lookup", async () => {
    const response = await handleRequest(
      new Request("https://feeds.example/build-info.json"),
      {},
      ctx,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual({
      ...buildInfo,
      cloudflare: { id: null, tag: null, timestamp: null },
    });
  });

  it("reports source and runtime identity on every request without consulting a cache", async () => {
    const sha = "a".repeat(40);
    Object.assign(buildInfo, {
      source_commit: sha,
      source_dirty: false,
      build_id: sha,
      built_at: "2026-10-12T00:00:00.000Z",
      release_version: "2026.10.1",
    });
    const cache = { match: vi.fn(), put: vi.fn() };
    for (const id of ["version-one", "version-two"]) {
      const metadata = { id, tag: "v2026.10.1", timestamp: "2026-10-12T00:01:00.000Z" };
      const response = await handleRequest(
        new Request("https://feeds.example/build-info.json?inspect=1"),
        { CF_VERSION_METADATA: metadata },
        ctx,
        cache,
      );
      expect(await response.json()).toEqual({ ...buildInfo, cloudflare: metadata });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(cache.match).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("preserves dirty identity without fabricating runtime fields and supports HEAD", async () => {
    Object.assign(buildInfo, { source_dirty: true });
    const response = await handleRequest(
      new Request("https://feeds.example/build-info.json"),
      { CF_VERSION_METADATA: { id: "local-id", tag: "", timestamp: "" } },
      ctx,
    );
    expect(await response.json()).toMatchObject({
      source_dirty: true,
      release_version: null,
      cloudflare: { id: "local-id", tag: null, timestamp: null },
    });
    const head = await handleRequest(
      new Request("https://feeds.example/build-info.json", { method: "HEAD" }),
      {},
      ctx,
    );
    expect(head.headers.get("Cache-Control")).toBe("no-store");
    expect(await head.text()).toBe("");
    const post = await handleRequest(
      new Request("https://feeds.example/build-info.json", { method: "POST" }),
      {},
      ctx,
    );
    expect(post.status).toBe(405);
  });
});
