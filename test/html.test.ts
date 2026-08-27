import { describe, expect, it } from "vitest";
import { cdata, decodeHtmlEntities, sanitizeHtmlContent } from "../src/html";

describe("HTML and XML text handling", () => {
  it("decodes named entities beyond the original hand-written subset", () => {
    expect(decodeHtmlEntities("Jos&eacute; &copy;")).toBe("José ©");
  });

  it("replaces invalid numeric entities without throwing", () => {
    expect(() => decodeHtmlEntities("bad: &#99999999; and &#x110000;")).not.toThrow();
    expect(decodeHtmlEntities("bad: &#99999999;")).toContain("�");
  });

  it("splits a CDATA terminator without changing the text", () => {
    expect(cdata("before]]>after")).toBe("<![CDATA[before]]]]><![CDATA[>after]]>");
  });

  it("removes executable attributes without changing matching prose", () => {
    const html =
      "<p>Setting one = 1 and online = true.</p>" +
      '<a href=javascript:alert(1) onclick="alert(2)">unsafe</a>' +
      '<svg/onload="alert(3)"></svg>';

    const sanitized = sanitizeHtmlContent(html);

    expect(sanitized).toContain("Setting one = 1 and online = true.");
    expect(sanitized).not.toMatch(/javascript:|onclick|onload/i);
  });
});
