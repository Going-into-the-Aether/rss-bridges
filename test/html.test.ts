import { describe, expect, it } from "vitest";
import { cdata, decodeHtmlEntities, sanitizeHtmlContent, xmlEscape } from "../src/html";

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

  it("removes XML-forbidden controls while preserving valid Unicode", () => {
    expect(xmlEscape("before\u0000 & \u0007after 😀")).toBe("before &amp; after 😀");
    expect(cdata("before\u0007after 😀")).toBe("<![CDATA[beforeafter 😀]]>");
  });

  it("removes executable attributes without changing matching prose", () => {
    const html =
      "<p>Setting one = 1 and online = true.</p>" +
      '<a href=javascript:alert(1) onclick="alert(2)">unsafe</a>' +
      '<a title="5 > 3" onclick="alert(4)">quoted angle</a>' +
      '<a href="javascript&colon;alert(5)">encoded scheme</a>' +
      '<svg/onload="alert(3)"></svg>';

    const sanitized = sanitizeHtmlContent(html);

    expect(sanitized).toContain("Setting one = 1 and online = true.");
    expect(sanitized).toContain('title="5 &gt; 3"');
    expect(sanitized).not.toMatch(/javascript:|onclick|onload/i);
  });

  it("preserves structural article attributes", () => {
    const sanitized = sanitizeHtmlContent(
      '<h2 id="section">Section</h2><table><tr><td colspan="2">Text</td></tr></table>',
    );
    expect(sanitized).toContain('<h2 id="section">');
    expect(sanitized).toContain('colspan="2"');
  });
});
