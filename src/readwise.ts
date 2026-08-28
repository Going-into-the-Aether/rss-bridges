import type { FeedItem, FeedResult } from "./types";

export type ReaderLocation = "new" | "later" | "archive" | "feed";

export interface ReaderDocument {
  url: string;
  html: string;
  title: string;
  author: string;
  summary: string;
  published_date: string;
  image_url?: string;
  location: ReaderLocation;
  category: "article";
  saved_using: "rss-bridges-tidings-bootstrap";
  tags: string[];
}

export interface ReaderSaveResult {
  status: 200 | 201;
  id: string;
}

export interface ReaderImportResult {
  eligible: number;
  created: number;
  existing: number;
  failed: number;
}

export function assertCompleteFeed(feed: FeedResult): void {
  if (!feed.diagnostic.ok || feed.diagnostic.partial) {
    throw new Error("Refusing partial Tidings import: every upstream source must complete");
  }
}

export function toReaderDocument(
  item: FeedItem,
  location: ReaderLocation = "later",
): ReaderDocument {
  return {
    url: item.url,
    html: item.contentHtml,
    title: item.title,
    author: item.authors.join("; "),
    summary: item.description,
    published_date: item.publishedAt,
    image_url: item.imageUrl,
    location,
    category: "article",
    saved_using: "rss-bridges-tidings-bootstrap",
    tags: ["tidings", "historical-import"],
  };
}

export async function saveReaderDocument(
  token: string,
  document: ReaderDocument,
  fetcher: typeof fetch = fetch,
): Promise<ReaderSaveResult> {
  const response = await fetcher("https://readwise.io/api/v3/save/", {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(document),
  });
  if (response.status !== 200 && response.status !== 201) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Reader save failed with HTTP ${response.status}: ${detail}`);
  }
  const body = (await response.json()) as { id?: string };
  if (!body.id) throw new Error(`Reader save returned HTTP ${response.status} without an id`);
  return { status: response.status, id: body.id };
}

export async function importReaderBacklog(
  items: FeedItem[],
  options: {
    apply: boolean;
    location?: ReaderLocation;
    save: (document: ReaderDocument) => Promise<ReaderSaveResult>;
    wait?: (milliseconds: number) => Promise<void>;
  },
): Promise<ReaderImportResult> {
  const result: ReaderImportResult = {
    eligible: items.length,
    created: 0,
    existing: 0,
    failed: 0,
  };
  if (!options.apply) return result;

  const wait =
    options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  for (const [index, item] of items.entries()) {
    try {
      const saved = await options.save(toReaderDocument(item, options.location));
      if (saved.status === 201) result.created += 1;
      else result.existing += 1;
    } catch (error) {
      result.failed += 1;
      console.error(`${item.url}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (index < items.length - 1) await wait(1_300);
  }
  return result;
}
