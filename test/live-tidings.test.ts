import { describe, expect, it } from "vitest";
import { buildTidingsFeed } from "../src/adapters/tidings";

const live = process.env.LIVE_TIDINGS === "1" ? describe : describe.skip;

live("live Tidings integration", () => {
  it("loads the 2025+ bootstrap with defensible author metadata", async () => {
    const result = await buildTidingsFeed({
      mode: "bootstrap",
      bootstrapAfter: "2025-01-01T00:00:00Z",
      rollingLimit: 200,
      pageFallbackLimit: 0,
    });

    console.info(
      JSON.stringify({
        items: result.items.length,
        authorFallbacks: result.diagnostic.authorFallbacks,
        sourceRecords: Object.fromEntries(
          Object.entries(result.diagnostic.sources).map(([name, source]) => [
            name,
            source.recordsFetched,
          ]),
        ),
        fallbackSamples: result.items
          .filter((item) => item.usedFallbackAuthor)
          .slice(0, 20)
          .map((item) => item.url),
      }),
    );

    expect(result.diagnostic.partial).toBe(false);
    expect(result.items.length).toBeGreaterThan(200);
    expect(result.items.every((item) => new Date(item.publishedAt) >= new Date("2025-01-01"))).toBe(
      true,
    );
    expect(result.items.flatMap((item) => item.authors)).not.toContain("fm_dev");

    const belinda = result.items.find((item) => item.url.endsWith("/articles/habits-of-grace/"));
    expect(belinda?.authors, JSON.stringify(belinda)).toContain("Belinda Stone");
    const greece = result.items.find((item) =>
      item.url.endsWith("/magazine/bible-weekend-in-greece/"),
    );
    expect(greece?.authors).toEqual(["James Andrews", "Steve Petrou"]);
    const storm = result.items.find((item) =>
      item.url.endsWith("/articles/what-the-storm-left-behind/"),
    );
    expect(storm?.authors).toEqual(["Nathan Giordano", "Antonia Giordano", "Dave Giordano"]);
  }, 120_000);
});
