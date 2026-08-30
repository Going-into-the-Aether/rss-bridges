import { decodeHTML } from "entities";
import sanitizeHtml from "sanitize-html";

export function decodeHtmlEntities(value: string): string {
  return decodeHTML(value);
}

export function stripHtml(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function absoluteContentUrl(value: string, baseUrl: string): string {
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (trimmed.startsWith("#")) return trimmed;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return value;
  }
}

function absoluteSrcset(value: string, baseUrl: string): string {
  return value
    .split(",")
    .map((candidate) => {
      const parts = candidate.trim().split(/\s+/);
      if (!parts[0]) return "";
      parts[0] = absoluteContentUrl(parts[0], baseUrl);
      return parts.join(" ");
    })
    .filter(Boolean)
    .join(", ");
}

export function sanitizeHtmlContent(value: string, baseUrl?: string): string {
  const contentBaseUrl = baseUrl ? new URL("/", baseUrl).toString() : undefined;
  return sanitizeHtml(value, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "figure", "figcaption"]),
    allowedAttributes: {
      "*": ["class", "id"],
      a: ["href", "name", "target", "title"],
      img: ["src", "srcset", "alt", "title", "width", "height", "loading"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan", "scope"],
      ol: ["start", "type"],
      blockquote: ["cite"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    transformTags: contentBaseUrl
      ? {
          a: (tagName, attributes) => ({
            tagName,
            attribs: {
              ...attributes,
              ...(attributes.href
                ? { href: absoluteContentUrl(attributes.href, contentBaseUrl) }
                : {}),
            },
          }),
          img: (tagName, attributes) => ({
            tagName,
            attribs: {
              ...attributes,
              ...(attributes.src
                ? { src: absoluteContentUrl(attributes.src, contentBaseUrl) }
                : {}),
              ...(attributes.srcset
                ? { srcset: absoluteSrcset(attributes.srcset, contentBaseUrl) }
                : {}),
            },
          }),
        }
      : undefined,
  }).trim();
}

export function stripInvalidXmlCharacters(value: string): string {
  return [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0)!;
      return (
        codePoint === 0x09 ||
        codePoint === 0x0a ||
        codePoint === 0x0d ||
        (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
        (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
        (codePoint >= 0x10000 && codePoint <= 0x10ffff)
      );
    })
    .join("");
}

export function xmlEscape(value: string): string {
  return stripInvalidXmlCharacters(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function cdata(value: string): string {
  return `<![CDATA[${stripInvalidXmlCharacters(value).replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}
