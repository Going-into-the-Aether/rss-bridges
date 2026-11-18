import { describe, expect, it } from "vitest";
import { sanitizeHtmlContent } from "../src/html";
import { sanitizeCases } from "./sanitize-html-cases";
import golden from "./fixtures/sanitize-html-golden.json";

describe("sanitized feed HTML golden output", () => {
  it("matches the output captured before the sanitize-html upgrade", () => {
    const actual = Object.fromEntries(
      sanitizeCases.map((item) => [item.id, sanitizeHtmlContent(item.html, item.baseUrl)]),
    );

    expect(Object.keys(actual)).toEqual(Object.keys(golden));
    expect(actual).toEqual(golden);
  });
});
