import { describe, expect, it, vi } from "vitest";
import {
  assertCompleteFeed,
  importReaderBacklog,
  saveReaderDocument,
  toReaderDocument,
} from "../src/readwise";
import type { FeedItem, FeedResult } from "../src/types";

const item: FeedItem = {
  id: "articles:1",
  title: "Faith & Fellowship",
  url: "https://tidings.org/articles/faith-fellowship/",
  publishedAt: "2026-08-25T13:00:00Z",
  modifiedAt: "2026-08-25T14:00:00Z",
  authors: ["James Andrews", "Steve Petrou"],
  description: "A useful summary.",
  contentHtml: "<p>The complete article.</p>",
  imageUrl: "https://tidings.org/image.webp",
  categories: [],
  sourceType: "articles",
  usedFallbackAuthor: false,
};

describe("Reader historical import", () => {
  it("refuses to import a partial upstream result", () => {
    const feed = {
      items: [item],
      diagnostic: { ok: false, partial: true },
    } as FeedResult;
    expect(() => assertCompleteFeed(feed)).toThrow("Refusing partial Tidings import");
  });

  it("maps full content and metadata into the Reader save contract", () => {
    expect(toReaderDocument(item, "archive")).toEqual({
      url: item.url,
      html: item.contentHtml,
      title: item.title,
      author: "James Andrews; Steve Petrou",
      summary: item.description,
      published_date: item.publishedAt,
      image_url: item.imageUrl,
      location: "archive",
      category: "article",
      saved_using: "rss-bridges-tidings-bootstrap",
      tags: ["tidings", "historical-import"],
    });
  });

  it("supports source-specific importer identity and category tags", () => {
    expect(
      toReaderDocument(item, "later", {
        savedUsing: "rss-bridges-the-christadelphian-bootstrap",
        tags: ["the-christadelphian", "historical-import", "faith-alive"],
      }),
    ).toMatchObject({
      saved_using: "rss-bridges-the-christadelphian-bootstrap",
      tags: ["the-christadelphian", "historical-import", "faith-alive"],
      location: "later",
    });
  });

  it("defaults historical imports to Later", () => {
    expect(toReaderDocument(item).location).toBe("later");
  });

  it("does not call Reader during a dry run", async () => {
    const save = vi.fn();
    const result = await importReaderBacklog([item], { apply: false, save });
    expect(save).not.toHaveBeenCalled();
    expect(result).toEqual({ eligible: 1, created: 0, existing: 0, failed: 0 });
  });

  it("counts server-side URL deduplication separately from new documents", async () => {
    const save = vi
      .fn()
      .mockResolvedValueOnce({ status: 201, id: "new-id" })
      .mockResolvedValueOnce({ status: 200, id: "existing-id" });
    const result = await importReaderBacklog([item, { ...item, id: "articles:2" }], {
      apply: true,
      save,
      wait: async () => undefined,
    });
    expect(result).toEqual({ eligible: 2, created: 1, existing: 1, failed: 0 });
  });

  it("passes source-specific document options through the importer", async () => {
    const save = vi.fn().mockResolvedValue({ status: 201, id: "new-id" });
    await importReaderBacklog([item], {
      apply: true,
      save,
      wait: async () => undefined,
      documentOptions: {
        savedUsing: "rss-bridges-the-christadelphian-bootstrap",
        tags: (feedItem) => ["the-christadelphian", feedItem.sourceType],
      },
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        saved_using: "rss-bridges-the-christadelphian-bootstrap",
        tags: ["the-christadelphian", "articles"],
      }),
    );
  });

  it("honors Retry-After on a bounded 429 retry", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("slow down", { status: 429, headers: { "Retry-After": "2" } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "created" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
    const wait = vi.fn(async () => undefined);

    await expect(
      saveReaderDocument("token", toReaderDocument(item), fetcher as typeof fetch, { wait }),
    ).resolves.toEqual({ status: 201, id: "created" });
    expect(wait).toHaveBeenCalledWith(2_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retries transient 5xx responses with exponential backoff", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "existing" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    const wait = vi.fn(async () => undefined);

    await expect(
      saveReaderDocument("token", toReaderDocument(item), fetcher as typeof fetch, { wait }),
    ).resolves.toEqual({ status: 200, id: "existing" });
    expect(wait).toHaveBeenCalledWith(1_000);
  });

  it("uses exponential backoff for a whitespace-only Retry-After header", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("temporary", { status: 503, headers: { "Retry-After": " " } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "existing" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    const wait = vi.fn(async () => undefined);

    await saveReaderDocument("token", toReaderDocument(item), fetcher as typeof fetch, { wait });

    expect(wait).toHaveBeenCalledWith(1_000);
  });

  it("uses exponential backoff for a negative Retry-After value", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("temporary", { status: 503, headers: { "Retry-After": "-1" } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "existing" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    const wait = vi.fn(async () => undefined);

    await saveReaderDocument("token", toReaderDocument(item), fetcher as typeof fetch, { wait });

    expect(wait).toHaveBeenCalledWith(1_000);
  });

  it("stops after bounded transient retries and reports the canonical URL", async () => {
    const fetcher = vi.fn(async () => new Response("temporary", { status: 503 }));
    const wait = vi.fn(async () => undefined);

    await expect(
      saveReaderDocument("token", toReaderDocument(item), fetcher as typeof fetch, {
        maxAttempts: 3,
        wait,
      }),
    ).rejects.toThrow(`${item.url}: Reader save failed with HTTP 503 after 3 attempts`);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[1_000], [2_000]]);
  });

  it("does not retry permanent failures and reports them as failed imports", async () => {
    const fetcher = vi.fn(async () => new Response("invalid", { status: 400 }));
    const wait = vi.fn(async () => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await importReaderBacklog([item], {
      apply: true,
      save: (document) => saveReaderDocument("token", document, fetcher as typeof fetch, { wait }),
      wait,
    });

    expect(result.failed).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(`${item.url}: Reader save failed with HTTP 400: invalid`);
    error.mockRestore();
  });
});
