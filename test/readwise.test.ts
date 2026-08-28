import { describe, expect, it, vi } from "vitest";
import { assertCompleteFeed, importReaderBacklog, toReaderDocument } from "../src/readwise";
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
});
