import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTidingsFeed, extractAuthors, normalizeCanonicalUrl } from "../src/adapters/tidings";
import existingOverrides from "../src/data/tidings-author-overrides.json";

const OUTPUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/data/tidings-author-overrides.json",
);
const BATCH_SIZE = 5;

async function authorsFromPage(url: string): Promise<string[]> {
  const response = await fetch(url, {
    headers: { "User-Agent": "rss-bridges-author-sync/0.1 (+https://feeds.atwood.fyi/tidings)" },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return extractAuthors(await response.text());
}

async function main(): Promise<void> {
  const result = await buildTidingsFeed({
    mode: "bootstrap",
    bootstrapAfter: "2025-01-01T00:00:00Z",
    rollingLimit: 200,
    pageFallbackLimit: 0,
    authorOverrides: existingOverrides,
  });
  const unresolved = result.items.filter((item) => item.usedFallbackAuthor);
  const overrides: Record<string, string[]> = { ...existingOverrides };

  console.log(
    `Scanning ${unresolved.length} unresolved canonical pages in batches of ${BATCH_SIZE}.`,
  );
  for (let index = 0; index < unresolved.length; index += BATCH_SIZE) {
    const batch = unresolved.slice(index, index + BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map((item) => authorsFromPage(item.url)));
    settled.forEach((outcome, itemIndex) => {
      const item = batch[itemIndex];
      if (outcome.status === "fulfilled" && outcome.value.length > 0) {
        overrides[normalizeCanonicalUrl(item.url)] = outcome.value;
      } else {
        const detail = outcome.status === "rejected" ? String(outcome.reason) : "no byline found";
        console.warn(`Unresolved: ${item.url} (${detail})`);
      }
    });
    console.log(
      `Processed ${Math.min(index + BATCH_SIZE, unresolved.length)}/${unresolved.length}.`,
    );
  }

  const ordered = Object.fromEntries(
    Object.entries(overrides).sort(([left], [right]) => left.localeCompare(right)),
  );
  await writeFile(OUTPUT_PATH, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
  console.log(`Wrote ${Object.keys(ordered).length} author overrides to ${OUTPUT_PATH}.`);
}

await main();
