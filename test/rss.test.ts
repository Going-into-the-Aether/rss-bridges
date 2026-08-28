import { describe, expect, it } from "vitest";
import { renderRss } from "../src/rss";
import type { FeedItem } from "../src/types";

describe("RSS rendering", () => {
  it("emits Reader-facing metadata and valid XML escaping", () => {
    const item: FeedItem = {
      id: "magazine:1",
      title: "Faith & Fellowship",
      url: "https://tidings.org/magazine/faith-fellowship/",
      publishedAt: "2026-08-25T13:00:00Z",
      modifiedAt: "2026-08-25T14:00:00Z",
      authors: ["James Andrews", "Steve Petrou"],
      description: "A summary with <meaning> & ]]> safely represented.",
      contentHtml: "<p>The complete article body.</p><p>Second ]]> paragraph.</p>",
      imageUrl: "https://tidings.org/image.webp?a=1&b=2",
      categories: ["Community & Fellowship"],
      sourceType: "magazine",
      usedFallbackAuthor: false,
    };
    const xml = renderRss(
      {
        title: "Tidings.org - All New Articles",
        homeUrl: "https://tidings.org/",
        feedUrl: "https://feeds.atwood.fyi/tidings",
        description: "Current Tidings articles",
        language: "en-us",
      },
      [item],
      new Date("2026-08-27T00:00:00Z"),
    );

    expect(xml).toContain("<title>Faith &amp; Fellowship</title>");
    expect(xml).toContain("<dc:creator>James Andrews</dc:creator>");
    expect(xml).toContain("<dc:creator>Steve Petrou</dc:creator>");
    expect(xml).not.toContain("fm_dev");
    expect(xml).toContain('media:thumbnail url="https://tidings.org/image.webp?a=1&amp;b=2"');
    expect(xml).toContain("<category>Community &amp; Fellowship</category>");
    expect(xml).toContain('atom:link href="https://feeds.atwood.fyi/tidings"');
    expect(xml).toContain("]]]]><![CDATA[>");
    expect(xml).toContain(
      "<content:encoded><![CDATA[<p>The complete article body.</p><p>Second ]]]]><![CDATA[> paragraph.</p>]]></content:encoded>",
    );
    expect(xml).toContain(
      "<description><![CDATA[<p>The complete article body.</p><p>Second ]]]]><![CDATA[> paragraph.</p>]]></description>",
    );
    expect(xml).not.toContain("A summary with <meaning>");
  });
});
