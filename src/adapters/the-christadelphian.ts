import { decodeHtmlEntities, sanitizeHtmlContent, stripHtml } from "../html";
import type { FeedItem, FeedResult, SourceDiagnostic } from "../types";

const BASE_URL = "https://thechristadelphian.com";
const POSTS_ENDPOINT = `${BASE_URL}/wp-json/wp/v2/posts`;
const FALLBACK_AUTHOR = "The Christadelphian Office";
const CATEGORY_LABELS: Record<number, string> = {
  1300: "The Christadelphian",
  1301: "Faith Alive",
};

interface RenderedField {
  rendered?: string | null;
}

interface FeaturedMedia {
  id?: number;
  source_url?: string | null;
}

export interface ChristadelphianPost {
  id: number;
  date_gmt: string;
  modified_gmt?: string | null;
  link: string;
  title: RenderedField;
  excerpt?: RenderedField | null;
  content?: RenderedField | null;
  featured_media: number;
  categories: number[];
  _embedded?: {
    "wp:featuredmedia"?: FeaturedMedia[];
  };
}

export interface ChristadelphianOptions {
  mode: "bootstrap" | "rolling";
  bootstrapAfter: string;
  rollingLimit: number;
  maxPages?: number;
  fetcher?: typeof fetch;
  now?: () => Date;
}

interface SourceFetch {
  records: ChristadelphianPost[];
  diagnostic: SourceDiagnostic;
}

function plausibleAuthor(value: string): boolean {
  const normalized = value.trim();
  return (
    normalized.length >= 3 &&
    normalized.length <= 120 &&
    /^[\p{L}][\p{L}\p{M}.'’ -]+$/u.test(normalized) &&
    !/^(?:the christadelphian(?: office)?|admin|editor|webmaster)$/i.test(normalized)
  );
}

export function extractChristadelphianAuthors(html: string): string[] {
  const candidates = [
    ...[
      ...html.matchAll(/<p\b[^>]*class=["'][^"']*\bAuthor\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi),
    ].map((match) => stripHtml(match[1])),
    ...[...html.matchAll(/\bBy\s*<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi)].map((match) =>
      stripHtml(match[1]),
    ),
  ];
  return [...new Set(candidates.map((candidate) => candidate.trim()).filter(plausibleAuthor))];
}

export function stripMagazineFooter(html: string): string {
  const boundary = html.search(/<h[1-6]\b[^>]*>\s*Our Magazines\s*<\/h[1-6]>/i);
  return (boundary >= 0 ? html.slice(0, boundary) : html).trim();
}

function normalizeCanonicalUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  }
  url.pathname = url.pathname === "/" ? "/" : `${url.pathname.replace(/\/+$/, "")}/`;
  return url.toString();
}

function wordpressGmt(value: string): string {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`;
}

function generatedExcerpt(contentHtml: string): string {
  const paragraphs = [...contentHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripHtml(match[1]))
    .filter((value) => value.length > 40);
  const source = paragraphs[0] ?? stripHtml(contentHtml);
  if (source.length <= 420) return source;
  return `${source.slice(0, 417).trimEnd()}…`;
}

function categoryLabels(record: ChristadelphianPost): string[] {
  return record.categories
    .map((category) => CATEGORY_LABELS[category])
    .filter((value): value is string => Boolean(value));
}

function sourceType(categories: string[]): string {
  if (categories.includes("Faith Alive")) return "faith-alive";
  if (categories.includes("The Christadelphian")) return "the-christadelphian";
  return "the-christadelphian-blog";
}

function imageUrl(record: ChristadelphianPost, contentHtml: string): string | undefined {
  const embedded = record._embedded?.["wp:featuredmedia"]?.[0]?.source_url;
  const candidate = embedded ?? contentHtml.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
  if (!candidate) return undefined;
  try {
    const url = new URL(decodeHtmlEntities(candidate), BASE_URL);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function mapPost(record: ChristadelphianPost): FeedItem {
  const rawContent = stripMagazineFooter(record.content?.rendered ?? "");
  const contentHtml = sanitizeHtmlContent(rawContent);
  if (!contentHtml) throw new Error(`Post ${record.id} has no usable article body`);
  const explicitAuthors = extractChristadelphianAuthors(rawContent);
  const categories = categoryLabels(record);
  const excerpt = stripHtml(record.excerpt?.rendered ?? "") || generatedExcerpt(contentHtml);
  return {
    id: `the-christadelphian:${record.id}`,
    title: decodeHtmlEntities(stripHtml(record.title.rendered ?? "Untitled")),
    url: normalizeCanonicalUrl(record.link),
    publishedAt: wordpressGmt(record.date_gmt),
    modifiedAt: wordpressGmt(record.modified_gmt ?? record.date_gmt),
    authors: explicitAuthors.length > 0 ? explicitAuthors : [FALLBACK_AUTHOR],
    description: excerpt,
    contentHtml,
    imageUrl: imageUrl(record, contentHtml),
    categories,
    sourceType: sourceType(categories),
    usedFallbackAuthor: explicitAuthors.length === 0,
  };
}

function exclusiveAfter(inclusiveStart: string): string {
  const start = new Date(inclusiveStart);
  if (Number.isNaN(start.getTime())) throw new Error(`Invalid bootstrap start: ${inclusiveStart}`);
  return new Date(start.getTime() - 1).toISOString();
}

async function fetchPosts(options: ChristadelphianOptions): Promise<SourceFetch> {
  const fetcher = options.fetcher ?? fetch;
  const records: ChristadelphianPost[] = [];
  let totalPages = 1;
  let pagesFetched = 0;
  const pageCap = Math.min(
    options.maxPages ?? 50,
    options.mode === "rolling"
      ? Math.ceil(options.rollingLimit / 100) + 1
      : Number.POSITIVE_INFINITY,
  );

  try {
    for (let page = 1; page <= totalPages; page += 1) {
      if (page > pageCap) {
        if (options.mode === "rolling") break;
        return {
          records,
          diagnostic: {
            ok: false,
            endpoint: POSTS_ENDPOINT,
            pagesFetched,
            recordsFetched: records.length,
            error: `Stopped posts after configured page cap ${pageCap}`,
          },
        };
      }
      const url = new URL(POSTS_ENDPOINT);
      url.searchParams.set("categories", "1300,1301");
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", String(page));
      url.searchParams.set("orderby", "date");
      url.searchParams.set("order", "desc");
      url.searchParams.set("_embed", "wp:featuredmedia");
      url.searchParams.set(
        "_fields",
        "id,date_gmt,modified_gmt,link,title,excerpt,content,featured_media,categories,_links,_embedded",
      );
      if (options.mode === "bootstrap") {
        url.searchParams.set("after", exclusiveAfter(options.bootstrapAfter));
      }

      const response = await fetcher(url, {
        headers: { "User-Agent": "rss-bridges/1.0 (+https://feeds.atwood.fyi)" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} from posts page ${page}`);
      records.push(...((await response.json()) as ChristadelphianPost[]));
      pagesFetched += 1;
      totalPages = Number.parseInt(response.headers.get("X-WP-TotalPages") ?? "1", 10);
      if (!Number.isFinite(totalPages) || totalPages < 1) totalPages = 1;
    }
    return {
      records,
      diagnostic: {
        ok: true,
        endpoint: POSTS_ENDPOINT,
        pagesFetched,
        recordsFetched: records.length,
      },
    };
  } catch (error) {
    return {
      records,
      diagnostic: {
        ok: false,
        endpoint: POSTS_ENDPOINT,
        pagesFetched,
        recordsFetched: records.length,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export async function buildChristadelphianFeed(
  options: ChristadelphianOptions,
): Promise<FeedResult> {
  const source = await fetchPosts(options);
  if (!source.diagnostic.ok && source.records.length === 0) {
    throw new Error(`The Christadelphian source failed: ${source.diagnostic.error}`);
  }
  let items = source.records
    .map(mapPost)
    .sort(
      (left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime(),
    );
  if (options.mode === "rolling") items = items.slice(0, options.rollingLimit);
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  return {
    items,
    diagnostic: {
      ok: source.diagnostic.ok,
      partial: !source.diagnostic.ok,
      generatedAt,
      mode: options.mode,
      sources: { posts: source.diagnostic },
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
