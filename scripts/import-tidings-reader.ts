import { buildTidingsFeed } from "../src/adapters/tidings";
import { importReaderBacklog, saveReaderDocument, type ReaderLocation } from "../src/readwise";

const apply = process.argv.includes("--apply");
const locationArg = process.argv.find((argument) => argument.startsWith("--location="));
const location = (locationArg?.split("=")[1] ?? "archive") as ReaderLocation;
if (!["new", "later", "archive", "feed"].includes(location)) {
  throw new Error(`Invalid Reader location: ${location}`);
}

const feed = await buildTidingsFeed({
  mode: "bootstrap",
  bootstrapAfter: "2025-01-01T00:00:00Z",
  rollingLimit: 200,
  pageFallbackLimit: 0,
});

console.log(`Eligible Tidings articles: ${feed.items.length}`);
if (!apply) {
  console.log("Dry run only. Re-run with --apply to write idempotently to Reader.");
}

const token = process.env.READWISE_TOKEN;
if (apply && !token) throw new Error("READWISE_TOKEN is required with --apply");

const result = await importReaderBacklog(feed.items, {
  apply,
  location,
  save: (document) => saveReaderDocument(token ?? "", document),
});
console.log(JSON.stringify(result, null, 2));
if (result.failed > 0) process.exitCode = 1;
