import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sanitizeHtml from "sanitize-html";
import { describe, expect, it } from "vitest";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const require = createRequire(import.meta.url);

type Lockfile = {
  packages: Record<string, { version?: string }>;
};

const lockfile = JSON.parse(readFileSync(join(repoRoot, "package-lock.json"), "utf8")) as Lockfile;

function installedVersion(name: string): string {
  const pkg = require(`${name}/package.json`) as { version: string };
  return pkg.version;
}

function lockedVersions(name: string): string[] {
  const suffix = `node_modules/${name}`;
  return Object.entries(lockfile.packages)
    .filter(([path]) => path === suffix || path.endsWith(`/${suffix}`))
    .map(([path, pkg]) => {
      if (!pkg.version) throw new Error(`${path} has no version`);
      return pkg.version;
    });
}

function compareVersions(left: string, right: string): number {
  const parse = (version: string) =>
    version
      .split("-")[0]
      .split(".")
      .map((part) => Number(part));
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a[index] ?? 0;
    const rightPart = b[index] ?? 0;
    if (Number.isNaN(leftPart) || Number.isNaN(rightPart)) {
      throw new Error(`non-numeric version "${left}" or "${right}"`);
    }
    if (leftPart !== rightPart) return leftPart - rightPart;
  }
  return 0;
}

function expectAtLeast(label: string, actual: string, minimum: string) {
  expect({ label, actual, meetsMinimum: compareVersions(actual, minimum) >= 0 }).toEqual({
    label,
    actual,
    meetsMinimum: true,
  });
}

describe("production dependency advisory floors", () => {
  // CVE-2026-113654, CVE-2026-113661, and CVE-2026-113657 are fixed in 2.18.0.
  // CVE-2026-93749 is fixed in source-map-js 1.2.2.
  it("resolves sanitize-html at or above 2.18.0", () => {
    const locked = lockedVersions("sanitize-html");
    expect(locked.length).toBeGreaterThan(0);
    for (const version of locked) expectAtLeast("lockfile sanitize-html", version, "2.18.0");
    expectAtLeast("installed sanitize-html", installedVersion("sanitize-html"), "2.18.0");
  });

  it("resolves source-map-js at or above 1.2.2", () => {
    const locked = lockedVersions("source-map-js");
    expect(locked.length).toBeGreaterThan(0);
    for (const version of locked) expectAtLeast("lockfile source-map-js", version, "1.2.2");
    expectAtLeast("installed source-map-js", installedVersion("source-map-js"), "1.2.2");
  });
});

describe("sanitize-html advisory behavior", () => {
  // These options are the non-default configurations named by the advisories.
  // The worker allowlist in src/html.ts is covered by the golden output test.
  it("drops a namespace-prefixed SMIL animation that retargets a link (CVE-2026-113657)", () => {
    const output = sanitizeHtml(
      '<svg><a href="#safe"><svg:animate attributeName="href" values="#safe;javascript:alert(1)" dur=".01s" fill="freeze"/><text>Click</text></a></svg>',
      {
        allowedTags: ["svg", "a", "svg:animate", "text"],
        allowedAttributes: {
          a: ["href"],
          "svg:animate": ["attributeName", "values", "dur", "fill"],
        },
        allowedSchemes: ["http", "https"],
      },
    );

    expect(output).toContain("<text>Click</text>");
    expect(output).toContain('href="#safe"');
    expect(output).not.toMatch(/javascript:/i);
  });

  it("does not keep a javascript: meta refresh destination (CVE-2026-113661)", () => {
    const output = sanitizeHtml('<meta http-equiv="refresh" content="0;url=javascript:alert(1)">', {
      allowedTags: ["meta"],
      allowedAttributes: { meta: ["http-equiv", "content"] },
    });

    expect(output).toContain('http-equiv="refresh"');
    expect(output).not.toMatch(/javascript:/i);
  });

  it("does not promote markup closed from inside noscript (CVE-2026-113654)", () => {
    const output = sanitizeHtml(
      '<div><noscript></div><img src="https://example.com/pixel.gif"></noscript>',
      {
        allowedTags: ["div", "img"],
        allowedAttributes: { img: ["src"] },
        nonTextTags: ["script", "style", "textarea", "option", "noscript"],
      },
    );

    expect(output).toContain("<div>");
    expect(output).not.toContain("<img");
  });
});
