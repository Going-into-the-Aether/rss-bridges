import { buildTidingsFeed } from "./adapters/tidings";
import { buildChristadelphianFeed } from "./adapters/the-christadelphian";
import { renderRss } from "./rss";
import type { FeedDiagnostic } from "./types";

export interface Env {
  TIDINGS_MODE?: "bootstrap" | "rolling";
  TIDINGS_BOOTSTRAP_AFTER?: string;
  TIDINGS_ROLLING_LIMIT?: string;
  TIDINGS_PAGE_FALLBACK_LIMIT?: string;
  TIDINGS_AUTHOR_FALLBACK_THRESHOLD?: string;
  CHRISTADELPHIAN_MODE?: "bootstrap" | "rolling";
  CHRISTADELPHIAN_BOOTSTRAP_AFTER?: string;
  CHRISTADELPHIAN_ROLLING_LIMIT?: string;
  COMPLETE_CACHE_TTL?: string;
  PARTIAL_CACHE_TTL?: string;
}

interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

function integerSetting(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonnegativeIntegerSetting(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function tidingsOptions(env: Env) {
  return {
    mode: env.TIDINGS_MODE === "bootstrap" ? ("bootstrap" as const) : ("rolling" as const),
    bootstrapAfter: env.TIDINGS_BOOTSTRAP_AFTER ?? "2025-01-01T00:00:00Z",
    rollingLimit: integerSetting(env.TIDINGS_ROLLING_LIMIT, 200),
    pageFallbackLimit: nonnegativeIntegerSetting(env.TIDINGS_PAGE_FALLBACK_LIMIT, 0),
    authorFallbackThreshold: nonnegativeIntegerSetting(env.TIDINGS_AUTHOR_FALLBACK_THRESHOLD, 0),
  };
}

export function christadelphianOptions(env: Env) {
  return {
    mode: env.CHRISTADELPHIAN_MODE === "rolling" ? ("rolling" as const) : ("bootstrap" as const),
    bootstrapAfter: env.CHRISTADELPHIAN_BOOTSTRAP_AFTER ?? "2024-01-01T00:00:00Z",
    rollingLimit: integerSetting(env.CHRISTADELPHIAN_ROLLING_LIMIT, 200),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=UTF-8" },
  });
}

async function generateStatusResponse(
  request: Request,
  env: Env,
  ctx: ExecutionContextLike,
  cache: CacheLike,
  canonicalPath: string,
  buildDiagnostic: () => Promise<FeedDiagnostic>,
): Promise<Response> {
  const cacheKey = new Request(new URL(canonicalPath, request.url).toString(), { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) {
    const payload = (await cached.json()) as FeedDiagnostic & { cacheStatus?: string };
    const response = jsonResponse({ ...payload, cacheStatus: "HIT" }, cached.status);
    const cacheControl = cached.headers.get("Cache-Control");
    if (cacheControl) response.headers.set("Cache-Control", cacheControl);
    response.headers.set("X-RSS-Bridge-Cache", "HIT");
    return response;
  }

  const diagnostic = await buildDiagnostic();
  const ttl = diagnostic.partial
    ? integerSetting(env.PARTIAL_CACHE_TTL, 300)
    : integerSetting(env.COMPLETE_CACHE_TTL, 3600);
  const response = jsonResponse({ ...diagnostic, cacheStatus: "MISS" });
  response.headers.set("Cache-Control", `public, max-age=${ttl}`);
  response.headers.set("X-RSS-Bridge-Cache", "MISS");
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function generateTidingsFeed(request: Request, env: Env): Promise<Response> {
  const result = await buildTidingsFeed(tidingsOptions(env));
  const ttl = result.diagnostic.partial
    ? integerSetting(env.PARTIAL_CACHE_TTL, 300)
    : integerSetting(env.COMPLETE_CACHE_TTL, 3600);
  const feedUrl = new URL("/tidings", request.url).toString();
  const xml = renderRss(
    {
      title: "Tidings.org - All New Articles",
      homeUrl: "https://tidings.org/",
      feedUrl,
      description: "New Tidings.org articles aggregated from current WordPress content types.",
      language: "en-us",
    },
    result.items,
    new Date(result.diagnostic.generatedAt),
  );

  return new Response(xml, {
    headers: {
      "Cache-Control": `public, max-age=${ttl}`,
      "Content-Type": "application/rss+xml; charset=UTF-8",
      "X-RSS-Bridge-Items": String(result.items.length),
      "X-RSS-Bridge-Partial": String(result.diagnostic.partial),
    },
  });
}

async function generateChristadelphianRss(request: Request, env: Env): Promise<Response> {
  const result = await buildChristadelphianFeed(christadelphianOptions(env));
  const ttl = result.diagnostic.partial
    ? integerSetting(env.PARTIAL_CACHE_TTL, 300)
    : integerSetting(env.COMPLETE_CACHE_TTL, 3600);
  const feedUrl = new URL("/the-christadelphian", request.url).toString();
  const xml = renderRss(
    {
      title: "The Christadelphian Office - Blog",
      homeUrl: "https://thechristadelphian.com/category/blog/",
      feedUrl,
      description:
        "Full articles from The Christadelphian and Faith Alive blogs, linked to the original publisher.",
      language: "en-gb",
    },
    result.items,
    new Date(result.diagnostic.generatedAt),
  );
  return new Response(xml, {
    headers: {
      "Cache-Control": `public, max-age=${ttl}`,
      "Content-Type": "application/rss+xml; charset=UTF-8",
      "X-RSS-Bridge-Items": String(result.items.length),
      "X-RSS-Bridge-Partial": String(result.diagnostic.partial),
    },
  });
}

export async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContextLike,
  cache: CacheLike = caches.default,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);
  if (url.pathname === "/") return Response.redirect(new URL("/tidings", url).toString(), 302);

  if (url.pathname === "/tidings/status") {
    try {
      const response = await generateStatusResponse(
        request,
        env,
        ctx,
        cache,
        "/tidings/status",
        async () => (await buildTidingsFeed(tidingsOptions(env))).diagnostic,
      );
      return request.method === "HEAD" ? new Response(null, response) : response;
    } catch (error) {
      return jsonResponse(
        { ok: false, error: error instanceof Error ? error.message : String(error) },
        502,
      );
    }
  }

  if (url.pathname === "/the-christadelphian/status") {
    try {
      const response = await generateStatusResponse(
        request,
        env,
        ctx,
        cache,
        "/the-christadelphian/status",
        async () => (await buildChristadelphianFeed(christadelphianOptions(env))).diagnostic,
      );
      return request.method === "HEAD" ? new Response(null, response) : response;
    } catch (error) {
      return jsonResponse(
        { ok: false, error: error instanceof Error ? error.message : String(error) },
        502,
      );
    }
  }

  const isTidings = url.pathname === "/tidings" || url.pathname === "/tidings/feed";
  const isChristadelphian =
    url.pathname === "/the-christadelphian" || url.pathname === "/the-christadelphian/feed";
  if (!isTidings && !isChristadelphian) {
    return jsonResponse({ error: "Not found" }, 404);
  }

  const canonicalPath = isTidings ? "/tidings" : "/the-christadelphian";
  const cacheKey = new Request(new URL(canonicalPath, url).toString(), { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) {
    const response = new Response(cached.body, cached);
    response.headers.set("X-RSS-Bridge-Cache", "HIT");
    return request.method === "HEAD" ? new Response(null, response) : response;
  }

  try {
    const response = isTidings
      ? await generateTidingsFeed(request, env)
      : await generateChristadelphianRss(request, env);
    response.headers.set("X-RSS-Bridge-Cache", "MISS");
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return request.method === "HEAD" ? new Response(null, response) : response;
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      502,
    );
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, ctx);
  },
};
