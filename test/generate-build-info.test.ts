import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectBuildInfo, generateBuildInfo } from "../scripts/generate-build-info";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFileSync: vi.fn(),
}));

describe("build provenance generation", () => {
  const sha = "b".repeat(40);
  let root: string;
  let status: string;
  let tags: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "rss-build-test-"));
    status = "";
    tags = "";
    vi.mocked(execFileSync).mockImplementation((_file, args) => {
      switch (args?.[3]) {
        case "rev-parse":
          return sha;
        case "ls-files":
          return "";
        case "status":
          return status;
        case "tag":
          return tags;
        default:
          throw new Error("Unexpected git command");
      }
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.resetAllMocks();
  });

  it("generates full source identity and a real build timestamp without inventing a release", () => {
    const before = Date.now();
    const info = generateBuildInfo(root);
    expect(info).toMatchObject({
      schema_version: 1,
      source_commit: sha,
      build_id: sha,
      source_dirty: false,
      release_version: null,
    });
    expect(Date.parse(info.built_at!)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(info.built_at!)).toBeLessThanOrEqual(Date.now());
    expect(readFileSync(join(root, "generated/build-info.ts"), "utf8")).toContain(sha);
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["--no-optional-locks", "-c", "core.fileMode=true", "tag", "--points-at", "HEAD"],
      expect.objectContaining({ cwd: root }),
    );
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      [
        "--no-optional-locks",
        "-c",
        "core.fileMode=true",
        "status",
        "--porcelain",
        "--untracked-files=all",
      ],
      expect.anything(),
    );
  });

  it("uses only one valid exact tag returned by Git", () => {
    tags = "snapshot-2026-10-12\nv2026.10.1\nv0.1.0";
    expect(collectBuildInfo(root, true).release_version).toBe("2026.10.1");
    tags = "";
    expect(collectBuildInfo(root).release_version).toBeNull();
    expect(collectBuildInfo(root, true).release_version).toBeNull();
  });

  it.each([
    "v2026.13.1",
    "v2026.0.1",
    "v2026.10.0",
    "v2026.10.01",
    "v2026.01.1",
    "v2026.10.1-rc1",
    "2026.10.1",
  ])("rejects malformed milestone tag %s", (tag) => {
    tags = tag;
    expect(collectBuildInfo(root).release_version).toBeNull();
  });

  it.each([" M src/index.ts", "M  src/index.ts", "?? new-source.ts"])(
    "reports dirty %s and refuses strict preparation",
    (dirty) => {
      status = dirty;
      tags = "v2026.10.1";
      expect(collectBuildInfo(root)).toMatchObject({ source_dirty: true, release_version: null });
      expect(() => generateBuildInfo(root, true)).toThrow("clean source");
      expect(existsSync(join(root, "generated/build-info.ts"))).toBe(false);
    },
  );

  it("refuses ambiguous exact release identity", () => {
    tags = "v2026.10.1\nv2026.10.2";
    expect(() => collectBuildInfo(root)).toThrow("Multiple CalVer tags");
  });

  it.each(["rev-parse", "status", "tag", "ls-files"])(
    "fails closed on Git %s failure",
    (command) => {
      vi.mocked(execFileSync).mockImplementation((_file, args) => {
        if (args?.[3] === command) throw new Error("private path must not leak");
        return args?.[3] === "rev-parse" ? sha : "";
      });
      expect(() => generateBuildInfo(root)).toThrow(`Git ${command} failed`);
      expect(existsSync(join(root, "generated/build-info.ts"))).toBe(false);
    },
  );

  it("rejects short SHAs", () => {
    vi.mocked(execFileSync).mockReturnValue("abcdef0");
    expect(() => collectBuildInfo(root)).toThrow("40-character");
  });

  it("exits nonzero outside Git without generating unknown deployment metadata", () => {
    mkdirSync(join(root, "scripts"));
    const script = join(root, "scripts/generate-build-info.ts");
    copyFileSync("scripts/generate-build-info.ts", script);
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Git rev-parse failed");
    expect(result.stdout).toBe("");
    expect(existsSync(join(root, "generated/build-info.ts"))).toBe(false);
  });
});

describe("moving source and hidden index flags", () => {
  it("rejects a changed HEAD instead of emitting stale provenance", () => {
    let heads = 0;
    vi.mocked(execFileSync).mockImplementation((_file, args) => {
      if (args?.[3] === "rev-parse") return ++heads === 1 ? "a".repeat(40) : "b".repeat(40);
      return "";
    });
    expect(() => collectBuildInfo(".")).toThrow("HEAD changed");
    vi.resetAllMocks();
  });
  it.each(["h hidden-source.ts\0", "S hidden-source.ts\0"])(
    "refuses hidden index flag %s in strict mode",
    (flags) => {
      vi.mocked(execFileSync).mockImplementation((_file, args) => {
        if (args?.[3] === "rev-parse") return "a".repeat(40);
        if (args?.[3] === "ls-files") return flags;
        return "";
      });
      expect(() => collectBuildInfo(".", true)).toThrow("clean source");
      vi.resetAllMocks();
    },
  );
});
