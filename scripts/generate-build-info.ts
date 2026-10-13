import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import type { BuildInfo } from "../src/build-info";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

function git(root: string, args: string[]): string {
  try {
    const output = execFileSync(
      "git",
      [
        "--no-optional-locks",
        "-c",
        "core.fileMode=true",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.trustctime=true",
        "-c",
        "core.checkstat=default",
        ...args,
      ],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
          ),
          GIT_NO_REPLACE_OBJECTS: "1",
        },
      },
    );
    return args.includes("-z") ? output : output.replace(/\n$/, "");
  } catch {
    throw new Error(`Git ${args[0]} failed; build provenance was not generated.`);
  }
}

function trackedBytesMatch(root: string, commit: string): boolean {
  const tree = git(root, ["ls-tree", "-r", "-z", "--full-tree", commit]);
  if (tree.includes("\uFFFD")) throw new Error("Ambiguous Git filename encoding.");
  for (const entry of tree.split("\0")) {
    if (!entry) continue;
    const delimiter = entry.indexOf("\t");
    if (delimiter < 0) throw new Error("Malformed Git tree record.");
    const [mode, kind, expected] = entry.slice(0, delimiter).split(" ");
    const parts = entry.slice(delimiter + 1).split("/");
    let parent = root;
    for (const [position, part] of parts.entries()) {
      if (!readdirSync(parent).includes(part)) return false;
      parent = resolve(parent, part);
      if (position < parts.length - 1) {
        const directory = lstatSync(parent);
        if (directory.isSymbolicLink() || !directory.isDirectory()) return false;
      }
    }
    const target = parent;
    const current = lstatSync(target, { throwIfNoEntry: false });
    if (!current) return false;
    let content: Buffer;
    if (mode === "120000" && current.isSymbolicLink()) {
      content = readlinkSync(target, { encoding: "buffer" });
    } else if ((mode === "100644" || mode === "100755") && current.isFile()) {
      if (Boolean(current.mode & 0o100) !== (mode === "100755")) return false;
      content = readFileSync(target);
    } else {
      return false;
    }
    const actual = createHash("sha1")
      .update(`blob ${content.length}\0`)
      .update(content)
      .digest("hex");
    if (kind !== "blob" || actual !== expected) return false;
  }
  return true;
}

function indexMatchesHead(root: string, commit: string): boolean {
  const expected = new Map<string, string>();
  for (const entry of git(root, ["ls-tree", "-r", "-z", "--full-tree", commit]).split("\0")) {
    if (!entry) continue;
    const delimiter = entry.indexOf("\t");
    const [mode, , oid] = entry.slice(0, delimiter).split(" ");
    expected.set(entry.slice(delimiter + 1), `${mode} ${oid}`);
  }
  const actual = new Map<string, string>();
  for (const entry of git(root, ["ls-files", "--stage", "-z"]).split("\0")) {
    if (!entry) continue;
    const delimiter = entry.indexOf("\t");
    const [mode, oid, stage] = entry.slice(0, delimiter).split(" ");
    if (stage !== "0") return false;
    actual.set(entry.slice(delimiter + 1), `${mode} ${oid}`);
  }
  return (
    actual.size === expected.size &&
    [...expected].every(([path, value]) => actual.get(path) === value)
  );
}

export function collectBuildInfo(root: string, strict = false): BuildInfo {
  if (realpathSync(git(root, ["rev-parse", "--show-toplevel"])) !== realpathSync(root)) {
    throw new Error("Expected the project repository root.");
  }
  const sourceCommit = git(root, ["rev-parse", "--verify", "HEAD"]);
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new Error("Expected a full 40-character source SHA.");
  }
  const hidden = git(root, ["ls-files", "-v", "-z"])
    .split("\0")
    .some((entry) => entry !== "" && (entry[0] === "S" || entry[0] !== entry[0].toUpperCase()));
  const sourceDirty =
    hidden ||
    git(root, ["ls-files", "--others", "--exclude-standard", "-z"]) !== "" ||
    !indexMatchesHead(root, sourceCommit) ||
    !trackedBytesMatch(root, sourceCommit);
  const tags = git(root, ["tag", "--no-column", "--points-at", "HEAD"])
    .split("\n")
    .filter((tag) => /^v[1-9]\d{3}\.(?:[1-9]|1[0-2])\.[1-9]\d*$/.test(tag));
  if (tags.length > 1) throw new Error("Multiple CalVer tags identify HEAD; resolve ambiguity.");
  if (strict && sourceDirty) throw new Error("Release preparation requires a clean source.");
  if (git(root, ["rev-parse", "--verify", "HEAD"]) !== sourceCommit) {
    throw new Error("Source HEAD changed during provenance generation.");
  }
  return {
    schema_version: 1,
    source_commit: sourceCommit,
    source_dirty: sourceDirty,
    built_at: new Date().toISOString(),
    build_id: sourceCommit,
    release_version: !sourceDirty && tags.length === 1 ? tags[0].slice(1) : null,
  };
}

export function generateBuildInfo(root = projectRoot, strict = false): BuildInfo {
  const info = collectBuildInfo(root, strict);
  const output = resolve(root, "generated/build-info.ts");
  const directory = lstatSync(dirname(output), { throwIfNoEntry: false });
  if (directory && (!directory.isDirectory() || directory.isSymbolicLink())) {
    throw new Error("Refusing linked build metadata directory.");
  }
  const existing = lstatSync(output, { throwIfNoEntry: false });
  if (existing && (!existing.isFile() || existing.nlink > 1)) {
    throw new Error("Refusing to overwrite linked build metadata.");
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(
    output,
    `// Generated by scripts/generate-build-info.ts. Do not commit.\nimport type { BuildInfo } from "../src/build-info";\nexport const buildInfo: BuildInfo = ${JSON.stringify(info, null, 2)};\n`,
  );
  return info;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    if (process.argv.slice(2).some((arg) => arg !== "--strict")) {
      throw new Error("Usage: node scripts/generate-build-info.ts [--strict]");
    }
    const info = generateBuildInfo(
      projectRoot,
      process.argv.includes("--strict") || process.env.RSS_BRIDGES_RELEASE === "1",
    );
    console.info(JSON.stringify(info));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Build provenance generation failed.");
    process.exitCode = 1;
  }
}
