import { cdata, xmlEscape } from "./html";
import type { FeedItem } from "./types";

export interface FeedMetadata {
  title: string;
  homeUrl: string;
  feedUrl: string;
  description: string;
  language: string;
}

function itemXml(item: FeedItem): string {
  const authors = item.authors
    .map((author) => `      <dc:creator>${xmlEscape(author)}</dc:creator>`)
    .join("\n");
  const categories = item.categories
    .map((category) => `      <category>${xmlEscape(category)}</category>`)
    .join("\n");
  const image = item.imageUrl
    ? `\n      <media:thumbnail url="${xmlEscape(item.imageUrl)}" />`
    : "";

  return `    <item>
      <title>${xmlEscape(item.title)}</title>
      <link>${xmlEscape(item.url)}</link>
      <guid isPermaLink="true">${xmlEscape(item.url)}</guid>
      <pubDate>${new Date(item.publishedAt).toUTCString()}</pubDate>
${authors}
      <description>${cdata(item.description)}</description>
      <content:encoded>${cdata(item.description)}</content:encoded>${image}
${categories}
    </item>`;
}

export function renderRss(
  metadata: FeedMetadata,
  items: FeedItem[],
  generatedAt = new Date(),
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${xmlEscape(metadata.title)}</title>
    <link>${xmlEscape(metadata.homeUrl)}</link>
    <description>${xmlEscape(metadata.description)}</description>
    <language>${xmlEscape(metadata.language)}</language>
    <generator>Cloudflare Worker - RSS Bridges</generator>
    <lastBuildDate>${generatedAt.toUTCString()}</lastBuildDate>
    <atom:link href="${xmlEscape(metadata.feedUrl)}" rel="self" type="application/rss+xml" />
${items.map(itemXml).join("\n")}
  </channel>
</rss>`;
}
