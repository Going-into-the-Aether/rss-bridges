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
  retained: number;
  rejected: number;
  missing: number;
  failed: number;
}

export interface ReaderReconciliationResult {
  status: "retained" | "rejected" | "missing";
  reason?: string;
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

export interface ReaderReconciliationOptions {
  maxAttempts?: number;
  pollDelayMilliseconds?: number;
  wait?: (milliseconds: number) => Promise<void>;
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

export async function reconcileReaderDocument(
  token: string,
  expected: ReaderDocument,
  documentId: string,
  fetcher: typeof fetch = fetch,
  options: ReaderReconciliationOptions = {},
): Promise<ReaderReconciliationResult> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 4));
  const pollDelayMilliseconds = Math.max(3_100, options.pollDelayMilliseconds ?? 3_100);
  const wait =
    options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  let attempt = 0;
  while (true) {
    attempt += 1;
    const query = new URLSearchParams({ id: documentId, withHtmlContent: "true" });
    const response = await fetcher(`https://readwise.io/api/v3/list/?${query.toString()}`, {
      headers: { Authorization: `Token ${token}` },
    });
    const retryable = response.status === 429 || response.status >= 500;
    if (response.status !== 200 && retryable && attempt < maxAttempts) {
      await response.text();
      const retryAfterSeconds = Number(response.headers.get("Retry-After")?.trim());
      const retryAfterMilliseconds =
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
          ? retryAfterSeconds * 1_000
          : 0;
      await wait(Math.max(pollDelayMilliseconds, retryAfterMilliseconds));
      continue;
    }
    if (response.status !== 200) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(
        `${expected.url}: Reader reconciliation failed with HTTP ${response.status}: ${detail}`,
      );
    }

    const body = (await response.json()) as {
      results?: Array<{
        id?: string;
        source_url?: string;
        location?: string;
        tags?: Record<string, unknown>;
        html_content?: string;
      }>;
    };
    const document = body.results?.find((candidate) => candidate.id === documentId);
    if (!document) {
      if (attempt < maxAttempts) {
        await wait(pollDelayMilliseconds);
        continue;
      }
      return { status: "missing", reason: "document not found by exact id" };
    }

    if (document.source_url !== expected.url)
      return { status: "rejected", reason: "canonical URL mismatch" };
    if (document.location !== expected.location)
      return { status: "rejected", reason: "location mismatch" };
    const retainedTags = new Set(Object.keys(document.tags ?? {}));
    const missingContent = !document.html_content?.trim();
    const missingTags = expected.tags.some((tag) => !retainedTags.has(tag));
    if (missingContent || missingTags) {
      if (attempt < maxAttempts) {
        await wait(pollDelayMilliseconds);
        continue;
      }
      return {
        status: "rejected",
        reason: missingContent ? "full HTML content missing" : "tag mismatch",
      };
    }
    return { status: "retained" };
  }
}

export async function importReaderBacklog(
  items: FeedItem[],
  options: {
    apply: boolean;
    location?: ReaderLocation;
    save: (document: ReaderDocument) => Promise<ReaderSaveResult>;
    reconcile?: (
      document: ReaderDocument,
      saved: ReaderSaveResult,
    ) => Promise<ReaderReconciliationResult>;
    wait?: (milliseconds: number) => Promise<void>;
    documentOptions?: ReaderImportDocumentOptions;
  },
): Promise<ReaderImportResult> {
  const result: ReaderImportResult = {
    eligible: items.length,
    created: 0,
    existing: 0,
    retained: 0,
    rejected: 0,
    missing: 0,
    failed: 0,
  };
  if (!options.apply) return result;

  const wait =
    options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  for (const [index, item] of items.entries()) {
    let saved: ReaderSaveResult;
    let document: ReaderDocument;
    try {
      const documentOptions = options.documentOptions
        ? {
            savedUsing: options.documentOptions.savedUsing,
            tags: options.documentOptions.tags(item),
          }
        : undefined;
      document = toReaderDocument(item, options.location, documentOptions);
      saved = await options.save(document);
      if (saved.status === 201) result.created += 1;
      else result.existing += 1;
    } catch (error) {
      result.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(message.startsWith(`${item.url}:`) ? message : `${item.url}: ${message}`);
      if (index < items.length - 1) await wait(options.reconcile ? 3_100 : 1_300);
      continue;
    }
    if (options.reconcile) {
      try {
        const reconciliation = await options.reconcile(document, saved);
        result[reconciliation.status] += 1;
        if (reconciliation.status !== "retained") {
          console.error(`${item.url}: ${reconciliation.reason ?? reconciliation.status}`);
        }
      } catch (error) {
        result.failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(message.startsWith(`${item.url}:`) ? message : `${item.url}: ${message}`);
      }
    }
    if (index < items.length - 1) await wait(options.reconcile ? 3_100 : 1_300);
  }
  return result;
}
