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
  saved_using: string;
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

export interface ReaderDocumentOptions {
  savedUsing: string;
  tags: string[];
}

export interface ReaderImportDocumentOptions {
  savedUsing: string;
  tags: (item: FeedItem) => string[];
}

export interface ReaderSaveOptions {
  maxAttempts?: number;
  baseDelayMilliseconds?: number;
  maxDelayMilliseconds?: number;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

export function assertCompleteFeed(feed: FeedResult, sourceName = "Tidings"): void {
  if (!feed.diagnostic.ok || feed.diagnostic.partial) {
    throw new Error(`Refusing partial ${sourceName} import: every upstream source must complete`);
  }
}

export function toReaderDocument(
  item: FeedItem,
  location: ReaderLocation = "later",
  options: ReaderDocumentOptions = {
    savedUsing: "rss-bridges-tidings-bootstrap",
    tags: ["tidings", "historical-import"],
  },
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
    saved_using: options.savedUsing,
    tags: options.tags,
  };
}

export async function saveReaderDocument(
  token: string,
  document: ReaderDocument,
  fetcher: typeof fetch = fetch,
  options: ReaderSaveOptions = {},
): Promise<ReaderSaveResult> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 4));
  const baseDelayMilliseconds = Math.max(0, options.baseDelayMilliseconds ?? 1_000);
  const maxDelayMilliseconds = Math.max(
    baseDelayMilliseconds,
    options.maxDelayMilliseconds ?? 60_000,
  );
  const wait =
    options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? Date.now;

  let attempt = 0;
  while (true) {
    attempt += 1;
    const response = await fetcher("https://readwise.io/api/v3/save/", {
      method: "POST",
      headers: {
        Authorization: `Token ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(document),
    });
    if (response.status === 200 || response.status === 201) {
      const body = (await response.json()) as { id?: string };
      if (!body.id)
        throw new Error(
          `${document.url}: Reader save returned HTTP ${response.status} without an id`,
        );
      return { status: response.status, id: body.id };
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < maxAttempts) {
      await response.text();
      const retryAfter = response.headers.get("Retry-After");
      let delay = baseDelayMilliseconds * 2 ** (attempt - 1);
      const normalizedRetryAfter = retryAfter?.trim();
      if (normalizedRetryAfter) {
        const seconds = Number(normalizedRetryAfter);
        const unsignedSeconds = /^\d+(?:\.\d+)?$/.test(normalizedRetryAfter);
        const retryDate = unsignedSeconds ? Number.NaN : Date.parse(normalizedRetryAfter);
        if (unsignedSeconds && Number.isFinite(seconds)) delay = seconds * 1_000;
        else if (!/^[+-]?\d/.test(normalizedRetryAfter) && Number.isFinite(retryDate))
          delay = Math.max(0, retryDate - now());
      }
      await wait(Math.min(delay, maxDelayMilliseconds));
      continue;
    }

    const detail = (await response.text()).slice(0, 500);
    const attempts = retryable ? ` after ${attempt} attempts` : "";
    throw new Error(
      `${document.url}: Reader save failed with HTTP ${response.status}${attempts}: ${detail}`,
    );
  }
}

export async function importReaderBacklog(
  items: FeedItem[],
  options: {
    apply: boolean;
    location?: ReaderLocation;
    save: (document: ReaderDocument) => Promise<ReaderSaveResult>;
    wait?: (milliseconds: number) => Promise<void>;
    documentOptions?: ReaderImportDocumentOptions;
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
      const documentOptions = options.documentOptions
        ? {
            savedUsing: options.documentOptions.savedUsing,
            tags: options.documentOptions.tags(item),
          }
        : undefined;
      const saved = await options.save(toReaderDocument(item, options.location, documentOptions));
      if (saved.status === 201) result.created += 1;
      else result.existing += 1;
    } catch (error) {
      result.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(message.startsWith(`${item.url}:`) ? message : `${item.url}: ${message}`);
    }
    if (index < items.length - 1) await wait(1_300);
  }
  return result;
}
