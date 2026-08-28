import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ChristadelphianPost } from "../src/adapters/the-christadelphian";

const ENDPOINT = "https://thechristadelphian.com/wp-json/wp/v2/posts";
const MINIMUM_POSTS = 48;

function outputPath(): string {
  const argument = process.argv.find((value) => value.startsWith("--output="));
  if (!argument) throw new Error("Usage: npm run snapshot:christadelphian -- --output=<path>");
  return resolve(argument.slice("--output=".length));
}

async function fetchPosts(): Promise<ChristadelphianPost[]> {
  const posts: ChristadelphianPost[] = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page += 1) {
    const url = new URL(ENDPOINT);
    url.searchParams.set("categories", "1300,1301");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    url.searchParams.set("orderby", "date");
    url.searchParams.set("order", "desc");
    url.searchParams.set("after", "2023-12-31T23:59:59.999Z");
    url.searchParams.set("_embed", "wp:featuredmedia");
    url.searchParams.set(
      "_fields",
      "id,date_gmt,modified_gmt,link,title,excerpt,content,featured_media,categories,_links,_embedded",
    );
    const response = await fetch(url, {
      headers: { "User-Agent": "rss-bridges-snapshot/1.0 (+https://feeds.atwood.fyi)" },
    });
    const contentType = response.headers.get("Content-Type") ?? "";
    if (!response.ok) throw new Error(`HTTP ${response.status} from posts page ${page}`);
    if (!/\bapplication\/json\b/i.test(contentType)) {
      throw new Error(
        `Unexpected content type ${contentType || "missing"} from posts page ${page}`,
      );
    }
    const pagePosts: unknown = await response.json();
    if (!Array.isArray(pagePosts)) throw new Error(`Posts page ${page} is not an array`);
    posts.push(
      ...(pagePosts as ChristadelphianPost[]).map((post) => ({
        id: post.id,
        date_gmt: post.date_gmt,
        modified_gmt: post.modified_gmt,
        link: post.link,
        title: post.title,
        excerpt: post.excerpt,
        content: post.content,
        featured_media: post.featured_media,
        categories: post.categories,
        _embedded: post._embedded?.["wp:featuredmedia"]?.[0]
          ? {
              "wp:featuredmedia": [
                {
                  id: post._embedded["wp:featuredmedia"][0].id,
                  source_url: post._embedded["wp:featuredmedia"][0].source_url,
                },
              ],
            }
          : undefined,
      })),
    );
    totalPages = Number.parseInt(response.headers.get("X-WP-TotalPages") ?? "1", 10);
    if (!Number.isFinite(totalPages) || totalPages < 1) totalPages = 1;
  }
  const uniqueIds = new Set(posts.map((post) => post.id));
  if (posts.length < MINIMUM_POSTS || uniqueIds.size !== posts.length) {
    throw new Error(
      `Snapshot guard failed: ${posts.length} posts, ${uniqueIds.size} unique, minimum ${MINIMUM_POSTS}`,
    );
  }
  return posts;
}

const posts = await fetchPosts();
await writeFile(
  outputPath(),
  `${JSON.stringify({ fetchedAt: new Date().toISOString(), posts }, null, 2)}\n`,
  "utf8",
);
console.log(`Wrote ${posts.length} posts to ${outputPath()}`);
