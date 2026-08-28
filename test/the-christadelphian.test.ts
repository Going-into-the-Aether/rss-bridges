import { describe, expect, it, vi } from "vitest";
import {
  buildChristadelphianFeed,
  extractChristadelphianAuthors,
  type ChristadelphianPost,
} from "../src/adapters/the-christadelphian";

function post(overrides: Partial<ChristadelphianPost> = {}): ChristadelphianPost {
  return {
    id: 117869,
    date_gmt: "2026-08-18T13:00:10",
    modified_gmt: "2026-08-18T13:10:10",
    link: "https://thechristadelphian.com/blog/the-christadelphian/known-by-name/",
    title: { rendered: "Known by name" },
    excerpt: { rendered: "<p>A useful summary.</p>" },
    content: {
      rendered:
        "<p>Complete article body with enough text for a generated Reader summary when needed.</p>",
    },
    featured_media: 117870,
    categories: [1300],
    _embedded: {
      "wp:featuredmedia": [
        {
          id: 117870,
          source_url: "https://thechristadelphian.com/wp-content/uploads/2026/04/known-by-name.png",
        },
      ],
    },
    ...overrides,
  };
}

function jsonPage(records: ChristadelphianPost[], totalPages = 1): Response {
  return new Response(JSON.stringify(records), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-WP-Total": String(records.length),
      "X-WP-TotalPages": String(totalPages),
    },
  });
}

describe("theChristadelphian.com adapter", () => {
  it("extracts only explicit defensible article bylines", () => {
    expect(extractChristadelphianAuthors('<p class="Author">Harry Whittaker</p>')).toEqual([
      "Harry Whittaker",
    ]);
    expect(extractChristadelphianAuthors("<p>By <strong>Mary Smith</strong></p>")).toEqual([
      "Mary Smith",
    ]);
    expect(extractChristadelphianAuthors('<p class="Author">By Harry Whittaker</p>')).toEqual([
      "Harry Whittaker",
    ]);
    expect(
      extractChristadelphianAuthors(
        '<p class="Author">By <strong>Harry Whittaker</strong></p><p>By <strong>Harry Whittaker</strong></p>',
      ),
    ).toEqual(["Harry Whittaker"]);
    expect(
      extractChristadelphianAuthors("<p>By <strong>faith</strong> Abraham obeyed.</p>"),
    ).toEqual([]);
    expect(
      extractChristadelphianAuthors('<p class="Author">The Christadelphian Office</p>'),
    ).toEqual([]);
  });

  it("maps both source categories, featured media, full content, and author fallback", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(new URL(String(input)).pathname).toBe("/wp-json/wp/v2/posts");
      return jsonPage([
        post(),
        post({
          id: 115985,
          link: "https://thechristadelphian.com/blog/faith-alive/called-by-name/",
          title: { rendered: "&#8220;Called by name&#8221;" },
          excerpt: { rendered: "" },
          content: {
            rendered:
              '<p>Another complete article body with enough text to generate a useful fallback summary.</p><p class="Author">Harry Whittaker</p>',
          },
          categories: [1301],
          featured_media: 0,
          _embedded: {},
        }),
      ]);
    });

    const result = await buildChristadelphianFeed({
      mode: "bootstrap",
      bootstrapAfter: "2024-01-01T00:00:00Z",
      rollingLimit: 200,
      fetcher: fetcher as typeof fetch,
      now: () => new Date("2026-08-28T00:00:00Z"),
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      authors: ["The Christadelphian Office"],
      categories: ["The Christadelphian"],
      usedFallbackAuthor: true,
      imageUrl: "https://thechristadelphian.com/wp-content/uploads/2026/04/known-by-name.png",
    });
    expect(result.items[1]).toMatchObject({
      title: "“Called by name”",
      authors: ["Harry Whittaker"],
      categories: ["Faith Alive"],
      usedFallbackAuthor: false,
    });
    expect(result.items[1].description).toContain("Another complete article body");
    expect(result.items[0].contentHtml).toContain("Complete article body");
    expect(result.diagnostic.authorFallbacks).toBe(1);
    expect(String(fetcher.mock.calls[0][0])).toContain("categories=1300%2C1301");
    expect(String(fetcher.mock.calls[0][0])).toContain("_links%2C_embedded");
  });

  it("paginates and reports a failed later page as partial", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const page = new URL(String(input)).searchParams.get("page");
      return page === "1" ? jsonPage([post()], 2) : new Response("unavailable", { status: 503 });
    });
    const result = await buildChristadelphianFeed({
      mode: "bootstrap",
      bootstrapAfter: "2024-01-01T00:00:00Z",
      rollingLimit: 200,
      fetcher: fetcher as typeof fetch,
    });
    expect(result.items).toHaveLength(1);
    expect(result.diagnostic.partial).toBe(true);
    expect(result.diagnostic.sources.posts.recordsFetched).toBe(1);
  });

  it("falls back when Worker egress receives HTML instead of WordPress JSON", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith("/wp-json/")) {
        return new Response("<html><head><title>Intercepted</title></head></html>", {
          status: 200,
          headers: { "Content-Type": "text/html; charset=UTF-8" },
        });
      }
      expect(url.searchParams.get("rest_route")).toBe("/wp/v2/posts");
      return jsonPage([post()]);
    });

    const result = await buildChristadelphianFeed({
      mode: "bootstrap",
      bootstrapAfter: "2024-01-01T00:00:00Z",
      rollingLimit: 200,
      fetcher: fetcher as typeof fetch,
    });

    expect(result.items).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.diagnostic.sources.posts.endpoint).toContain("rest_route");
  });
});
