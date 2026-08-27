import { describe, expect, it } from "vitest";
import { cdata, decodeHtmlEntities } from "../src/html";

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
});
