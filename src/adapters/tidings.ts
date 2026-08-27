import { decodeHtmlEntities, stripHtml } from "../html";
import type { FeedItem, FeedResult, SourceDiagnostic } from "../types";
import tidingsAuthorOverrides from "../data/tidings-author-overrides.json";

const BASE_URL = "https://tidings.org";
const FALLBACK_AUTHOR = "The Christadelphian Tidings";
const SOURCE_TYPES = ["magazine", "articles"] as const;

interface RenderedField {
  rendered?: string | null;
}

export interface WordPressRecord {
  id: number;
  type: string;
  date_gmt: string;
  modified_gmt?: string;
  link: string;
  title: RenderedField;
  excerpt?: RenderedField | null;
  content?: RenderedField | null;
}

export interface TidingsOptions {
  mode: "bootstrap" | "rolling";
  bootstrapAfter: string;
  rollingLimit: number;
  pageFallbackLimit?: number;
  maxSourcePages?: number;
  authorOverrides?: Record<string, string[]>;
  fetcher?: typeof fetch;
  now?: () => Date;
}

interface SourceFetch {
  records: WordPressRecord[];
  diagnostic: SourceDiagnostic;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function plausibleAuthor(value: string): boolean {
  const normalized = value.trim();
  return (
    normalized.length >= 3 &&
    normalized.length <= 120 &&
    !/^fm_dev$/i.test(normalized) &&
    !/ecclesia|editor|tidings|@|https?:/i.test(normalized) &&
    /[a-z]/i.test(normalized)
  );
}

function splitAuthorLine(value: string): string[] {
  const normalized = value.replace(/^\s*by\s+/i, "").replace(/^[,\s]+|[,\s]+$/g, "");
  const semicolonParts = normalized.split(/\s*;\s*/);
  return semicolonParts.flatMap((part) => {
    const conjunction = part.match(/^(.+?)\s+(?:and|&)\s+(.+)$/i);
    if (conjunction && conjunction[1].trim().split(/\s+/).length >= 2) {
      return [conjunction[1], conjunction[2]].map((name) => name.trim()).filter(plausibleAuthor);
    }
    return plausibleAuthor(part) ? [part] : [];
  });
}

export function extractAuthors(html: string): string[] {
  const explicit = [...html.matchAll(/\bBy\s*<b[^>]*>([\s\S]*?)<\/b>/gi)].flatMap((match) =>
    splitAuthorLine(stripHtml(match[1])),
  );
  if (explicit.length > 0) return unique(explicit);

  const paragraphBodies = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(
    (match) => match[1],
  );
  const authors = paragraphBodies.slice(-6).flatMap((paragraph) => {
    if (!/<br\s*\/?\s*>/i.test(paragraph)) return [];
    const withoutBuilderClosers = paragraph.replace(/(?:\s*\[\/[a-z0-9_-]+\])+\s*$/gi, "");
    const italic = withoutBuilderClosers.match(/^\s*<(?:i|em)\b[^>]*>([\s\S]*?)<\/(?:i|em)>\s*$/i);
    const signatureBody = italic?.[1] ?? withoutBuilderClosers;
    const lines = stripHtml(signatureBody).split("\n");
    if (!lines.slice(1).some((line) => /ecclesia/i.test(line))) return [];
    const firstLine = lines[0]?.trim() ?? "";
    const beforeLocation = firstLine.split(",")[0]?.trim() ?? "";
    return splitAuthorLine(beforeLocation);
  });
  return unique(authors);
}

function exclusiveAfter(inclusiveStart: string): string {
  const start = new Date(inclusiveStart);
  if (Number.isNaN(start.getTime())) throw new Error(`Invalid bootstrap start: ${inclusiveStart}`);
  return new Date(start.getTime() - 1).toISOString();
}

export function extractImageUrl(html: string): string | undefined {
  const match = html.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
  return match ? decodeHtmlEntities(match[1]) : undefined;
}

export function normalizeCanonicalUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  }
  url.pathname = url.pathname === "/" ? "/" : `${url.pathname.replace(/\/+$/, "")}/`;
  return url.toString();
}

function descriptionFrom(record: WordPressRecord): string {
  const excerpt = stripHtml(record.excerpt?.rendered ?? "");
  if (excerpt) return excerpt;

  const content = stripHtml(record.content?.rendered ?? "");
  const firstParagraph = content.split("\n").find((line) => line.length > 40) ?? content;
  if (firstParagraph.length <= 420) return firstParagraph;
  return `${firstParagraph.slice(0, 417).trimEnd()}…`;
}

async function fallbackAuthorsFromPage(url: string, fetcher: typeof fetch): Promise<string[]> {
  try {
    const response = await fetcher(url, {
      headers: { "User-Agent": "rss-bridges/0.1 (+https://feeds.atwood.fyi/tidings)" },
    });
    if (!response.ok) return [];
    return extractAuthors(await response.text());
  } catch {
    return [];
  }
}

async function mapRecord(
  record: WordPressRecord,
  fetcher: typeof fetch,
  allowPageFallback: boolean,
  authorOverrides: Record<string, string[]>,
): Promise<FeedItem> {
  const content = record.content?.rendered ?? "";
  let authors = extractAuthors(content);
  const canonicalUrl = normalizeCanonicalUrl(record.link);
  if (authors.length === 0) authors = authorOverrides[canonicalUrl] ?? [];
  if (authors.length === 0 && allowPageFallback) {
    authors = await fallbackAuthorsFromPage(record.link, fetcher);
  }
  const usedFallbackAuthor = authors.length === 0;

  return {
    id: `${record.type}:${record.id}`,
    title: decodeHtmlEntities(stripHtml(record.title.rendered ?? "Untitled")),
    url: canonicalUrl,
    publishedAt: record.date_gmt,
    modifiedAt: record.modified_gmt ?? record.date_gmt,
    authors: usedFallbackAuthor ? [FALLBACK_AUTHOR] : authors,
    description: descriptionFrom(record),
    imageUrl: extractImageUrl(content),
    categories: [],
    sourceType: record.type,
    usedFallbackAuthor,
  };
}

async function mapInBatches(
  records: WordPressRecord[],
  fetcher: typeof fetch,
  pageFallbackLimit: number,
  authorOverrides: Record<string, string[]>,
  batchSize = 10,
): Promise<FeedItem[]> {
  const items: FeedItem[] = [];
  const pageFallbackIds = new Set(
    records
      .filter(
        (record) =>
          extractAuthors(record.content?.rendered ?? "").length === 0 &&
          !authorOverrides[normalizeCanonicalUrl(record.link)],
      )
      .slice(0, pageFallbackLimit)
      .map((record) => `${record.type}:${record.id}`),
  );
  for (let index = 0; index < records.length; index += batchSize) {
    items.push(
      ...(await Promise.all(
        records
          .slice(index, index + batchSize)
          .map((record) =>
            mapRecord(
              record,
              fetcher,
              pageFallbackIds.has(`${record.type}:${record.id}`),
              authorOverrides,
            ),
          ),
      )),
    );
  }
  return items;
}

async function fetchSource(
  sourceType: (typeof SOURCE_TYPES)[number],
  options: TidingsOptions,
): Promise<SourceFetch> {
  const fetcher = options.fetcher ?? fetch;
  const endpoint = `${BASE_URL}/wp-json/wp/v2/${sourceType}`;
  const records: WordPressRecord[] = [];
  let totalPages = 1;
  let pagesFetched = 0;
  const rollingPageCap = Math.ceil(options.rollingLimit / 100) + 1;
  const pageCap = Math.min(
    options.maxSourcePages ?? 50,
    options.mode === "rolling" ? rollingPageCap : Number.POSITIVE_INFINITY,
  );

  try {
    for (let page = 1; page <= totalPages; page += 1) {
      if (page > pageCap) {
        return {
          records,
          diagnostic: {
            ok: false,
            endpoint,
            pagesFetched,
            recordsFetched: records.length,
            error: `Stopped ${sourceType} after configured page cap ${pageCap}`,
          },
        };
      }
      const url = new URL(endpoint);
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", String(page));
      url.searchParams.set("orderby", "date");
      url.searchParams.set("order", "desc");
      url.searchParams.set("_fields", "id,type,date_gmt,modified_gmt,link,title,excerpt,content");
      if (options.mode === "bootstrap") {
        url.searchParams.set("after", exclusiveAfter(options.bootstrapAfter));
      }

      const response = await fetcher(url, {
        headers: { "User-Agent": "rss-bridges/0.1 (+https://feeds.atwood.fyi/tidings)" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} from ${sourceType} page ${page}`);
      const pageRecords = (await response.json()) as WordPressRecord[];
      records.push(...pageRecords);
      pagesFetched += 1;
      totalPages = Number.parseInt(response.headers.get("X-WP-TotalPages") ?? "1", 10);
      if (!Number.isFinite(totalPages) || totalPages < 1) totalPages = 1;
    }

    return {
      records,
      diagnostic: { ok: true, endpoint, pagesFetched, recordsFetched: records.length },
    };
  } catch (error) {
    return {
      records,
      diagnostic: {
        ok: false,
        endpoint,
        pagesFetched,
        recordsFetched: records.length,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function richerItem(left: FeedItem, right: FeedItem): FeedItem {
  const leftScore =
    left.description.length + (left.imageUrl ? 100 : 0) + (left.usedFallbackAuthor ? 0 : 100);
  const rightScore =
    right.description.length + (right.imageUrl ? 100 : 0) + (right.usedFallbackAuthor ? 0 : 100);
  if (leftScore !== rightScore) return leftScore > rightScore ? left : right;
  return new Date(left.modifiedAt) >= new Date(right.modifiedAt) ? left : right;
}

export function mergeItems(items: FeedItem[]): FeedItem[] {
  const byUrl = new Map<string, FeedItem>();
  for (const item of items) {
    const existing = byUrl.get(item.url);
    byUrl.set(item.url, existing ? richerItem(existing, item) : item);
  }
  return [...byUrl.values()].sort(
    (left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime(),
  );
}

export async function buildTidingsFeed(options: TidingsOptions): Promise<FeedResult> {
  const fetcher = options.fetcher ?? fetch;
  const sourceResults = await Promise.all(
    SOURCE_TYPES.map((source) => fetchSource(source, options)),
  );
  const completeSources = sourceResults.filter((result) => result.diagnostic.ok).length;
  const usableSources = sourceResults.filter((result) => result.records.length > 0).length;
  if (usableSources === 0) {
    const details = sourceResults.map((result) => result.diagnostic.error).join("; ");
    throw new Error(`All Tidings sources failed: ${details}`);
  }

  const mapped = await mapInBatches(
    sourceResults.flatMap((result) => result.records),
    fetcher,
    options.pageFallbackLimit ?? 2,
    options.authorOverrides ?? tidingsAuthorOverrides,
  );
  let items = mergeItems(mapped);
  if (options.mode === "rolling") items = items.slice(0, options.rollingLimit);
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const sources = Object.fromEntries(
    SOURCE_TYPES.map((source, index) => [source, sourceResults[index].diagnostic]),
  );

  return {
    items,
    diagnostic: {
      ok: completeSources === SOURCE_TYPES.length,
      partial: completeSources !== SOURCE_TYPES.length,
      generatedAt,
      mode: options.mode,
      sources,
      mergedItems: items.length,
      authorFallbacks: items.filter((item) => item.usedFallbackAuthor).length,
      newest: items[0]
        ? {
            title: items[0].title,
            url: items[0].url,
            publishedAt: items[0].publishedAt,
            authors: items[0].authors,
          }
        : null,
    },
  };
}
