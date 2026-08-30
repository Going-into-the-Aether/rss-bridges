import { buildChristadelphianFeed } from "../src/adapters/the-christadelphian";
import {
  assertCompleteFeed,
  importReaderBacklog,
  reconcileReaderDocument,
  saveReaderDocument,
  type ReaderLocation,
} from "../src/readwise";

const apply = process.argv.includes("--apply");
const locationArg = process.argv.find((argument) => argument.startsWith("--location="));
const location = (locationArg?.split("=")[1] ?? "later") as ReaderLocation;
const limitArg = process.argv.find((argument) => argument.startsWith("--limit="));
const parsedLimit = limitArg ? Number.parseInt(limitArg.split("=")[1] ?? "", 10) : undefined;
if (parsedLimit !== undefined && (!Number.isFinite(parsedLimit) || parsedLimit <= 0)) {
  throw new Error(`Invalid import limit: ${limitArg}`);
}
if (!["new", "later", "archive", "feed"].includes(location)) {
  throw new Error(`Invalid Reader location: ${location}`);
}

const feed = await buildChristadelphianFeed({
  mode: "bootstrap",
  bootstrapAfter: "2024-01-01T00:00:00Z",
  rollingLimit: 200,
});
assertCompleteFeed(feed, "theChristadelphian.com");

const uniqueUrls = new Set(feed.items.map((item) => item.url));
if (uniqueUrls.size !== feed.items.length) {
  throw new Error(
    `Refusing import with duplicate canonical URLs: ${feed.items.length - uniqueUrls.size}`,
  );
}
if (feed.items.length < 48) {
  throw new Error(
    `Refusing incomplete backlog: expected at least 48 items, received ${feed.items.length}`,
  );
}
const uncategorized = feed.items.filter((item) => item.categories.length === 0);
if (uncategorized.length > 0) {
  throw new Error(`Refusing import with ${uncategorized.length} uncategorized items`);
}

console.log(`Eligible theChristadelphian.com articles: ${feed.items.length}`);
console.log(
  JSON.stringify(
    {
      oldest: feed.items.at(-1)?.publishedAt,
      newest: feed.items[0]?.publishedAt,
      categories: Object.fromEntries(
        ["The Christadelphian", "Faith Alive"].map((category) => [
          category,
          feed.items.filter((item) => item.categories.includes(category)).length,
        ]),
      ),
      authorFallbacks: feed.diagnostic.authorFallbacks,
    },
    null,
    2,
  ),
);
if (!apply) {
  console.log("Dry run only. Re-run with --apply to write idempotently to Reader Later.");
}

const token = process.env.READWISE_TOKEN;
if (apply && !token) throw new Error("READWISE_TOKEN is required with --apply");

const selectedItems = parsedLimit === undefined ? feed.items : feed.items.slice(0, parsedLimit);
if (parsedLimit !== undefined) {
  console.log(`Pilot limit selected: ${selectedItems.length} of ${feed.items.length} articles.`);
}
const result = await importReaderBacklog(selectedItems, {
  apply,
  location,
  save: (document) => saveReaderDocument(token ?? "", document),
  reconcile: (document, saved) => reconcileReaderDocument(token ?? "", document, saved.id),
  documentOptions: {
    savedUsing: "rss-bridges-the-christadelphian-bootstrap",
    tags: (item) => ["the-christadelphian", "historical-import", item.sourceType],
  },
});
console.log(JSON.stringify(result, null, 2));
if (result.failed > 0 || result.rejected > 0 || result.missing > 0) process.exitCode = 1;
