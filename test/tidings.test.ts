import { describe, expect, it, vi } from "vitest";
import {
  buildTidingsFeed,
  extractAuthors,
  extractImageUrl,
  mergeItems,
  normalizeCanonicalUrl,
  type WordPressRecord,
} from "../src/adapters/tidings";
import type { FeedItem } from "../src/types";
import issue40Fixtures from "./fixtures/tidings-issue-40.json";

function record(overrides: Partial<WordPressRecord> = {}): WordPressRecord {
  return {
    id: 1,
    type: "articles",
    date_gmt: "2026-07-10T13:00:58",
    modified_gmt: "2026-08-25T13:04:03",
    link: "https://tidings.org/articles/habits-of-grace/",
    title: { rendered: "Habits of Grace" },
    excerpt: null,
    content: {
      rendered:
        '<p>Long enough opening article paragraph to become the generated excerpt for Reader.</p><p class="p8"><i>Belinda Stone,<br />Riverwood Ecclesia, NSW</i></p>',
    },
    ...overrides,
  };
}

function jsonPage(records: WordPressRecord[], totalPages = 1): Response {
  return new Response(JSON.stringify(records), {
    status: 200,
    headers: { "Content-Type": "application/json", "X-WP-TotalPages": String(totalPages) },
  });
}

describe("Tidings author extraction", () => {
  // Minimal excerpts from .issue-40-fixtures/<type>--<slug>.{rest.json,page.html},
  // captured on 2026-10-18. The Fear and Belief byline comes from REST only.
  it.each(
    issue40Fixtures.filter(
      (fixture) => !["truth-corps", "letters-to-the-editor-september-2026"].includes(fixture.slug),
    ),
  )("extracts the REST signature for $type/$slug", ({ content, authors }) => {
    expect(extractAuthors(content)).toEqual(authors);
  });

  it.each(issue40Fixtures.filter((fixture) => fixture.pageByline))(
    "matches the visible page byline for $type/$slug",
    ({ pageByline, authors }) => {
      expect(extractAuthors(pageByline!)).toEqual(authors);
    },
  );

  it.each([
    "<p><i>English Standard Version</i> is used throughout.</p>",
    "<p><i>May we all be faithful.</i></p>",
    "<p><i>Jesus Christ</i></p><p>The article continues here.</p>",
    "<p><i>fm_dev</i></p>",
    "<p><i>The Christadelphian Tidings</i></p>",
    "<p><i>Editor: Joe Hill</i></p>",
  ])("does not mistake prose or CMS metadata for a standalone signature: %s", (html) => {
    expect(extractAuthors(html)).toEqual([]);
  });

  it.each([
    "The Christadelphian",
    "Bible Magazine",
    "Christadelphian Bible Mission",
    "The Christadelphian Tidings",
  ])("rejects an organization or publication as a standalone signature: %s", (name) => {
    expect(extractAuthors(`<p>Body text here.</p><p><em>${name}</em></p>`)).toEqual([]);
  });

  it("extracts a standalone italic author name", () => {
    expect(extractAuthors("<p>Body text here.</p><p><em>Jason Hensley</em></p>")).toEqual([
      "Jason Hensley",
    ]);
  });

  it("extracts the displayed single author from the signature", () => {
    expect(
      extractAuthors('<p class="p8"><i>Belinda Stone,<br />Riverwood Ecclesia, NSW</i></p>'),
    ).toEqual(["Belinda Stone"]);
  });

  it("does not join an italic quotation to the following signature", () => {
    const html =
      '<p class="p4"><i>Let us not grow weary in doing good.</i> (Galatians 6:9)</p>' +
      '<p class="p8"><i>Belinda Stone,<br />Riverwood Ecclesia, NSW</i></p>';
    expect(extractAuthors(html)).toEqual(["Belinda Stone"]);
  });

  it("supports separate multi-author signatures", () => {
    const html =
      '<p class="p4"><i>James Andrews,<br />Kenilworth Ecclesia, UK</i></p>' +
      '<p class="p4"><i>Steve Petrou,<br />Toronto West Ecclesia, ON</i></p>';
    expect(extractAuthors(html)).toEqual(["James Andrews", "Steve Petrou"]);
  });

  it("supports WPBakery closers and plain contributor blocks", () => {
    expect(
      extractAuthors(
        "<p><i>Akilah Johnson,<br />May Pen Ecclesia, Jamaica</i>[/vc_column_text]</p>",
      ),
    ).toEqual(["Akilah Johnson"]);
    expect(
      extractAuthors("<p>Cory &amp; Kristel Crabill<br />Washington Ecclesia, D.C.</p>"),
    ).toEqual(["Cory & Kristel Crabill"]);
  });

  it("preserves a shared-surname joint byline", () => {
    expect(extractAuthors("<p><i>Aaron and Ann Riegle,<br />Portage Ecclesia, IN</i></p>")).toEqual(
      ["Aaron and Ann Riegle"],
    );
  });

  it("extracts an explicit page byline and rejects fm_dev", () => {
    expect(extractAuthors("<div>By <b>Mary Smith and John Jones</b></div>")).toEqual([
      "Mary Smith",
      "John Jones",
    ]);
    expect(extractAuthors("<div>By <b>fm_dev</b></div>")).toEqual([]);
  });

  it("splits three explicit authors into separate creators", () => {
    expect(
      extractAuthors("<div>By <b>Nathan Giordano, Antonia Giordano and Dave Giordano</b></div>"),
    ).toEqual(["Nathan Giordano", "Antonia Giordano", "Dave Giordano"]);
  });

  it("extracts a signature nested after prose without including the prose", () => {
    expect(
      extractAuthors(
        "<p>May we all be faithful. <i>Belinda Stone,<br />Riverwood Ecclesia, NSW</i></p>",
      ),
    ).toEqual(["Belinda Stone"]);
  });

  it("keeps a location when the italic signature closes before Ecclesia", () => {
    expect(
      extractAuthors(
        "<p><span><i>James DiLiberto,<br />Canterbury </i></span><i>Ecclesia, VIC</i></p>",
      ),
    ).toEqual(["James DiLiberto"]);
  });

  it("extracts an author from an unusually nested signature", () => {
    expect(
      extractAuthors(
        "<p><span><strong><em>Future Author,</em></strong><br /><span>Springfield Ecclesia, CA</span></span></p>",
      ),
    ).toEqual(["Future Author"]);
  });
});

describe("Tidings source aggregation", () => {
  it("resolves all 12 issue #40 items without page requests at the default threshold", async () => {
    const records = issue40Fixtures.map((fixture, index) =>
      record({
        id: index + 1,
        type: fixture.type,
        link: `https://tidings.org/${fixture.type}/${fixture.slug}/`,
        content: { rendered: fixture.content },
      }),
    );
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const type = url.pathname.match(/^\/wp-json\/wp\/v2\/(magazine|articles)$/)?.[1];
      if (!type) throw new Error(`Unexpected page request: ${url}`);
      return jsonPage(records.filter((item) => item.type === type));
    });
    const result = await buildTidingsFeed({
      mode: "rolling",
      bootstrapAfter: "2025-01-01T00:00:00Z",
      rollingLimit: 12,
      fetcher: fetcher as typeof fetch,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.items).toHaveLength(12);
    for (const fixture of issue40Fixtures) {
      expect(
        result.items.find(
          (item) => item.url === `https://tidings.org/${fixture.type}/${fixture.slug}/`,
        ),
      ).toMatchObject({
        authors: fixture.authors,
        usedFallbackAuthor: false,
      });
    }
    expect(result.diagnostic).toMatchObject({
      ok: true,
      partial: false,
      authorFallbacks: 0,
      authorFallbackThreshold: 0,
      authorFallbackExceeded: false,
      unresolvedAuthorUrls: [],
    });
  });

  it("keeps a reviewed no-byline fallback healthy without hiding other unresolved items", async () => {
    const unsigned = record({
      link: "https://TIDINGS.org/articles/reviewed-unsigned?utm_source=test",
      content: { rendered: "<p>Article without a byline.</p>" },
    });
    const unknown = record({
      id: 2,
      link: "https://tidings.org/articles/unreviewed/",
      content: unsigned.content,
    });
    let records = [unsigned];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/magazine")) return jsonPage([]);
      if (url.pathname.endsWith("/articles")) return jsonPage(records);
      throw new Error(`Unexpected page request: ${url}`);
    });
    const options = {
      mode: "bootstrap" as const,
      bootstrapAfter: "2025-01-01T00:00:00Z",
      rollingLimit: 200,
      pageFallbackLimit: 2,
      authorOverrides: { "https://tidings.org/articles/reviewed-unsigned/": [] },
      fetcher: fetcher as typeof fetch,
    };
    const reviewed = await buildTidingsFeed(options);
    expect(reviewed.items[0]).toMatchObject({
      authors: ["The Christadelphian Tidings"],
      usedFallbackAuthor: true,
    });
    expect(reviewed.diagnostic).toMatchObject({
      ok: true,
      partial: false,
      authorFallbacks: 0,
      authorFallbackThreshold: 0,
      unresolvedAuthorUrls: [],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    records = [unsigned, unknown];
    const unreviewed = await buildTidingsFeed({ ...options, pageFallbackLimit: 0 });
    expect(unreviewed.diagnostic).toMatchObject({
      ok: false,
      partial: true,
      authorFallbacks: 1,
      authorFallbackThreshold: 0,
      authorFallbackExceeded: true,
      unresolvedAuthorUrls: [unknown.link],
    });

    // A reviewed exemption must not hide a byline added later.
    records = [{ ...unsigned, content: { rendered: "<p><i>Anna Tikvah</i></p>" } }];
    const signed = await buildTidingsFeed(options);
    expect(signed.items[0]).toMatchObject({
      authors: ["Anna Tikvah"],
      usedFallbackAuthor: false,
    });
  });

  it("paginates, merges both post types, and preserves metadata", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const type = url.pathname.endsWith("/magazine") ? "magazine" : "articles";
      const page = Number(url.searchParams.get("page"));
      if (type === "magazine") {
        return page === 1
          ? jsonPage(
              [
                record({
                  id: 2,
                  type,
                  link: "https://tidings.org/magazine/bible-weekend-in-greece/",
                  title: { rendered: "Bible Weekend &amp; Fellowship" },
                  excerpt: { rendered: "<p>A useful summary.</p>" },
                  content: {
                    rendered:
                      '<p><img src="https://tidings.org/image.webp" /></p><p><i>James Andrews,<br>Kenilworth Ecclesia</i></p><p><i>Steve Petrou,<br>Toronto West Ecclesia</i></p>',
                  },
                }),
              ],
              2,
            )
          : jsonPage([], 2);
      }
      return jsonPage([record()]);
    });

    const result = await buildTidingsFeed({
      mode: "bootstrap",
      bootstrapAfter: "2025-01-01T00:00:00Z",
      rollingLimit: 200,
      pageFallbackLimit: 0,
      fetcher: fetcher as typeof fetch,
      now: () => new Date("2026-08-27T00:00:00Z"),
    });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].title).toBe("Bible Weekend & Fellowship");
    expect(result.items[0].authors).toEqual(["James Andrews", "Steve Petrou"]);
    expect(result.items[0].imageUrl).toBe("https://tidings.org/image.webp");
    expect(result.items[0].publishedAt).toBe("2026-07-10T13:00:58Z");
    expect(result.items[0].contentHtml).toContain("<img");
    expect(result.items[1].authors).toEqual(["Belinda Stone"]);
    expect(result.diagnostic.authorFallbacks).toBe(0);
    expect(String(fetcher.mock.calls[0][0])).toContain("after=2024-12-31T23%3A59%3A59.999Z");
  });

  it("preserves article markup while removing executable content", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return url.pathname.endsWith("/magazine")
        ? jsonPage([])
        : jsonPage([
            record({
              content: {
                rendered:
                  '<p onclick="alert(1)">Complete <strong>article</strong>.</p>' +
                  '<script>alert("unsafe")</script><a href="javascript:alert(1)">bad</a>',
              },
            }),
          ]);
    });

    const result = await buildTidingsFeed({
      mode: "bootstrap",
      bootstrapAfter: "2025-01-01T00:00:00Z",
      rollingLimit: 200,
      pageFallbackLimit: 0,
      fetcher: fetcher as typeof fetch,
    });

    expect(result.items[0].contentHtml).toContain("<strong>article</strong>");
    expect(result.items[0].contentHtml).not.toMatch(/onclick|script|javascript:/i);
  });

  it("returns the healthy source when the other source fails", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return url.pathname.endsWith("/magazine")
        ? new Response("unavailable", { status: 503 })
        : jsonPage([record()]);
    });
    const result = await buildTidingsFeed({
      mode: "bootstrap",
      bootstrapAfter: "2025-01-01T00:00:00Z",
      rollingLimit: 200,
      pageFallbackLimit: 0,
      fetcher: fetcher as typeof fetch,
    });
    expect(result.items).toHaveLength(1);
    expect(result.diagnostic.partial).toBe(true);
    expect(result.diagnostic.sources.magazine.ok).toBe(false);
  });

  it("preserves records fetched before a later page fails", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/articles")) return jsonPage([]);
      return url.searchParams.get("page") === "1"
        ? jsonPage([record({ type: "magazine" })], 2)
        : new Response("unavailable", { status: 503 });
    });
    const result = await buildTidingsFeed({
      mode: "bootstrap",
      bootstrapAfter: "2025-01-01T00:00:00Z",
      rollingLimit: 200,
      pageFallbackLimit: 0,
      fetcher: fetcher as typeof fetch,
    });
    expect(result.items).toHaveLength(1);
    expect(result.diagnostic.partial).toBe(true);
    expect(result.diagnostic.sources.magazine.recordsFetched).toBe(1);
    expect(result.diagnostic.sources.magazine.error).toContain("page 2");
  });

  it("preserves records and reports partial output at the bootstrap page cap", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return url.pathname.endsWith("/articles")
        ? jsonPage([])
        : jsonPage([record({ type: "magazine" })], 3);
    });
    const result = await buildTidingsFeed({
      mode: "bootstrap",
      bootstrapAfter: "2025-01-01T00:00:00Z",
      rollingLimit: 200,
      pageFallbackLimit: 0,
      maxSourcePages: 1,
      fetcher: fetcher as typeof fetch,
    });
    expect(result.items).toHaveLength(1);
    expect(result.diagnostic.partial).toBe(true);
    expect(result.diagnostic.sources.magazine.error).toContain("page cap 1");
  });

  it("reports rolling underfill when the configured page cap is exhausted", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const type = url.pathname.endsWith("/magazine") ? "magazine" : "articles";
      const page = Number(url.searchParams.get("page"));
      return jsonPage(
        [
          record({
            id: page,
            type,
            link: `https://tidings.org/${type}/item-${page}/`,
          }),
        ],
        50,
      );
    });
    const result = await buildTidingsFeed({
      mode: "rolling",
      bootstrapAfter: "2025-01-01T00:00:00Z",
      rollingLimit: 200,
      pageFallbackLimit: 0,
      maxSourcePages: 3,
      fetcher: fetcher as typeof fetch,
    });
    expect(result.diagnostic.partial).toBe(true);
    expect(result.diagnostic.ok).toBe(false);
    expect(result.diagnostic.underfilled).toBe(true);
    expect(result.diagnostic.underfillReason).toBe("page-cap-reached");
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it("fetches additional rolling pages after cross-source overlap", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get("page"));
      return jsonPage(
        [
          record({
            id: page,
            type: url.pathname.endsWith("/magazine") ? "magazine" : "articles",
            link: `https://tidings.org/shared/item-${page}/`,
          }),
        ],
        3,
      );
    });

    const result = await buildTidingsFeed({
      mode: "rolling",
      bootstrapAfter: "2025-01-01T00:00:00Z",
      rollingLimit: 3,
      pageFallbackLimit: 0,
      fetcher: fetcher as typeof fetch,
    });

    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(
      fetcher.mock.calls.map(([input]) => new URL(String(input)).searchParams.get("page")),
    ).toEqual(["1", "1", "2", "2", "3", "3"]);
    expect(result.items).toHaveLength(3);
    expect(result.diagnostic).toMatchObject({
      ok: true,
      partial: false,
      mergedItems: 3,
      targetItems: 3,
      underfilled: false,
    });
  });

  it("preserves collected records when a later adaptive page fails", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get("page"));
      const type = url.pathname.endsWith("/magazine") ? "magazine" : "articles";
      if (type === "magazine" && page === 3) {
        return new Response("unavailable", { status: 503 });
      }
      return jsonPage(
        [
          record({
            id: page,
            type,
            link: `https://tidings.org/shared/item-${page}/`,
          }),
        ],
        3,
      );
    });

    const result = await buildTidingsFeed({
      mode: "rolling",
      bootstrapAfter: "2025-01-01T00:00:00Z",
      rollingLimit: 3,
      pageFallbackLimit: 0,
      fetcher: fetcher as typeof fetch,
    });

    expect(result.items).toHaveLength(3);
    expect(result.diagnostic.partial).toBe(true);
    expect(result.diagnostic.underfilled).toBe(false);
    expect(result.diagnostic.sources.magazine).toMatchObject({
      ok: false,
      pagesFetched: 2,
      recordsFetched: 2,
    });
    expect(result.diagnostic.sources.magazine.error).toContain("page 3");
  });

  it("reports source exhaustion when overlap leaves the rolling feed underfilled", async () => {
    const fetcher = vi.fn(async () =>
      jsonPage([
        record({
          link: "https://tidings.org/shared/only-item/",
        }),
      ]),
    );

    const result = await buildTidingsFeed({
      mode: "rolling",
      bootstrapAfter: "2025-01-01T00:00:00Z",
      rollingLimit: 3,
      pageFallbackLimit: 0,
      fetcher: fetcher as typeof fetch,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.items).toHaveLength(1);
    expect(result.diagnostic).toMatchObject({
      ok: false,
      partial: true,
      mergedItems: 1,
      targetItems: 3,
      underfilled: true,
      underfillReason: "sources-exhausted",
    });
  });

  it("returns a valid empty feed when both sources are healthy and empty", async () => {
    const fetcher = vi.fn(async () => jsonPage([]));
    const result = await buildTidingsFeed({
      mode: "bootstrap",
      bootstrapAfter: "2030-01-01T00:00:00Z",
      rollingLimit: 200,
      pageFallbackLimit: 0,
      fetcher: fetcher as typeof fetch,
    });
    expect(result.items).toEqual([]);
    expect(result.diagnostic.ok).toBe(true);
    expect(result.diagnostic.partial).toBe(false);
  });

  it("skips one malformed permalink without failing the feed", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return url.pathname.endsWith("/magazine")
        ? jsonPage([])
        : jsonPage([record(), record({ id: 2, link: "not a valid URL" })]);
    });
    const result = await buildTidingsFeed({
      mode: "bootstrap",
      bootstrapAfter: "2025-01-01T00:00:00Z",
      rollingLimit: 200,
      fetcher: fetcher as typeof fetch,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].url).toBe("https://tidings.org/articles/habits-of-grace/");
  });

  it("resolves relative images and rejects executable image schemes", () => {
    expect(extractImageUrl('<img src="/wp-content/image.webp">')).toBe(
      "https://tidings.org/wp-content/image.webp",
    );
    expect(extractImageUrl('<img src="javascript:alert(1)">')).toBeUndefined();
  });

  it("uses a committed author override before the publication fallback", async () => {
    const unsigned = record({ content: { rendered: "<p>Article without a signature.</p>" } });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return url.pathname.endsWith("/magazine") ? jsonPage([]) : jsonPage([unsigned]);
    });
    const result = await buildTidingsFeed({
      mode: "bootstrap",
      bootstrapAfter: "2025-01-01T00:00:00Z",
      rollingLimit: 200,
      pageFallbackLimit: 0,
      authorOverrides: { [unsigned.link]: ["Belinda Stone"] },
      fetcher: fetcher as typeof fetch,
    });
    expect(result.items[0].authors).toEqual(["Belinda Stone"]);
    expect(result.diagnostic.authorFallbacks).toBe(0);
  });

  it("reports unresolved canonical author URLs and crosses the default threshold", async () => {
    const unsigned = record({
      link: "https://TIDINGS.org/articles/future-layout?utm_source=test",
      content: {
        rendered: "<p>Article body.</p><p><em>Future Author,<br />Remote location, CA</em></p>",
      },
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return url.pathname.endsWith("/magazine") ? jsonPage([]) : jsonPage([unsigned]);
    });

    const result = await buildTidingsFeed({
      mode: "bootstrap",
      bootstrapAfter: "2025-01-01T00:00:00Z",
      rollingLimit: 200,
      pageFallbackLimit: 0,
      authorOverrides: {},
      fetcher: fetcher as typeof fetch,
    });

    expect(result.items[0]).toMatchObject({
      authors: ["The Christadelphian Tidings"],
      usedFallbackAuthor: true,
      url: "https://tidings.org/articles/future-layout/",
    });
    expect(result.diagnostic).toMatchObject({
      ok: false,
      partial: true,
      authorFallbacks: 1,
      authorFallbackThreshold: 0,
      authorFallbackExceeded: true,
      unresolvedAuthorUrls: ["https://tidings.org/articles/future-layout/"],
    });
  });

  it("keeps diagnostics healthy within an explicitly allowed fallback threshold", async () => {
    const unsigned = record({ content: { rendered: "<p>Article without a signature.</p>" } });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return url.pathname.endsWith("/magazine") ? jsonPage([]) : jsonPage([unsigned]);
    });

    const result = await buildTidingsFeed({
      mode: "bootstrap",
      bootstrapAfter: "2025-01-01T00:00:00Z",
      rollingLimit: 200,
      pageFallbackLimit: 0,
      authorFallbackThreshold: 1,
      authorOverrides: {},
      fetcher: fetcher as typeof fetch,
    });

    expect(result.diagnostic).toMatchObject({
      ok: true,
      partial: false,
      authorFallbacks: 1,
      authorFallbackThreshold: 1,
      authorFallbackExceeded: false,
    });
  });

  it("normalizes record URLs before author override lookup", async () => {
    const unsigned = record({
      link: "https://TIDINGS.org/articles/habits-of-grace?utm_source=test",
      content: { rendered: "<p>Article without a signature.</p>" },
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return url.pathname.endsWith("/magazine") ? jsonPage([]) : jsonPage([unsigned]);
    });
    const result = await buildTidingsFeed({
      mode: "bootstrap",
      bootstrapAfter: "2025-01-01T00:00:00Z",
      rollingLimit: 200,
      pageFallbackLimit: 0,
      authorOverrides: { "https://tidings.org/articles/habits-of-grace/": ["Belinda Stone"] },
      fetcher: fetcher as typeof fetch,
    });
    expect(result.items[0].authors).toEqual(["Belinda Stone"]);
  });

  it("fails clearly when both sources fail", async () => {
    const fetcher = vi.fn(async () => new Response("unavailable", { status: 503 }));
    await expect(
      buildTidingsFeed({
        mode: "bootstrap",
        bootstrapAfter: "2025-01-01T00:00:00Z",
        rollingLimit: 200,
        pageFallbackLimit: 0,
        fetcher: fetcher as typeof fetch,
      }),
    ).rejects.toThrow("All Tidings sources failed");
  });
});

describe("normalization and deduplication", () => {
  it("normalizes tracking parameters without deleting meaningful parameters", () => {
    expect(
      normalizeCanonicalUrl("https://TIDINGS.org/articles/example?utm_source=x&edition=2#part"),
    ).toBe("https://tidings.org/articles/example/?edition=2");
  });

  it("keeps the richer duplicate", () => {
    const base: FeedItem = {
      id: "articles:1",
      title: "Example",
      url: "https://tidings.org/articles/example/",
      publishedAt: "2026-01-01T00:00:00Z",
      modifiedAt: "2026-01-02T00:00:00Z",
      authors: ["The Christadelphian Tidings"],
      description: "short",
      contentHtml: "<p>short</p>",
      categories: [],
      sourceType: "articles",
      usedFallbackAuthor: true,
    };
    const richer = {
      ...base,
      id: "magazine:2",
      authors: ["Real Author"],
      description: "A substantially richer description.",
      usedFallbackAuthor: false,
    };
    expect(mergeItems([base, richer])).toEqual([richer]);
  });
});
