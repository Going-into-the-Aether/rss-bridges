import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { execPath } from "node:process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSnapshotSandbox, type SnapshotSandbox } from "./snapshot-sandbox";

const script = readFileSync("scripts/publish-christadelphian-snapshot.sh", "utf8");
const launchAgent = readFileSync("ops/launchd/org.rss-bridges.snapshot.plist", "utf8");

describe("snapshot publisher transport boundaries", () => {
  it("uses a bounded public fetch but keeps changed snapshot pushes supervised", () => {
    expect(script).toContain(
      'public_data_remote="https://github.com/Going-into-the-Aether/rss-bridges.git"',
    );
    expect(script).toContain("origin_url=$(git remote get-url origin)");
    expect(script).toContain('[[ "$origin_url" != "$public_data_remote" ]]');
    expect(script).toContain("GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/usr/bin/false");
    expect(script).toContain("-- git -c credential.helper=");
    expect(script).toContain("fetch origin");
    expect(script).toContain('"+refs/heads/data:refs/remotes/origin/data"');
    expect(script).not.toContain('supervised_git "fetch public data branch"');
    expect(script).toContain(
      'supervised_git "push origin data" -C "$data_worktree" push origin data',
    );
  });

  it("requires a caller-supplied commit wrapper for unattended signing", () => {
    expect(script).toContain("commit_wrapper=${RSS_BRIDGES_COMMIT_WRAPPER:-}");
    expect(script).toContain('[[ -z "$commit_wrapper" || ! -x "$commit_wrapper" ]]');
    expect(script).toContain(
      "RSS_BRIDGES_COMMIT_WRAPPER must name an executable commit-signing wrapper.",
    );
    expect(launchAgent).toContain("<key>RSS_BRIDGES_COMMIT_WRAPPER</key>");
    expect(launchAgent).toContain("<string>__COMMIT_WRAPPER__</string>");

    const result = spawnSync("/bin/zsh", ["scripts/publish-christadelphian-snapshot.sh"], {
      encoding: "utf8",
      env: {
        ...process.env,
        RSS_BRIDGES_GIT_WRAPPER: execPath,
        RSS_BRIDGES_COMMIT_WRAPPER: "",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "RSS_BRIDGES_COMMIT_WRAPPER must name an executable commit-signing wrapper.",
    );
    expect(result.stderr).not.toContain("Dependencies are not installed");
  });

  it("delegates changed snapshot commits to the supplied signing wrapper", () => {
    expect(script).toContain(
      '"$commit_wrapper" -C "$data_worktree" commit -m "data: refresh Christadelphian snapshot"',
    );
    expect(script).not.toContain(
      'git -C "$data_worktree" commit -S -m "data: refresh Christadelphian snapshot"',
    );
  });
});

describe("snapshot publisher worktree cleanup", () => {
  let sandbox: SnapshotSandbox | undefined;
  afterEach(() => {
    if (sandbox) rmSync(sandbox.root, { recursive: true, force: true });
    sandbox = undefined;
  });

  const snapshotWorktrees = (box: SnapshotSandbox) =>
    box
      .git("worktree", "list", "--porcelain")
      .split("\n")
      .filter((line) => line.includes("rss-bridges-snapshot."));

  it("leaves no registered worktree when the push fails", () => {
    sandbox = createSnapshotSandbox();
    const result = sandbox.run(true);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("push rejected");
    expect(snapshotWorktrees(sandbox)).toEqual([]);
  });

  it("leaves no registered worktree after a successful push", () => {
    sandbox = createSnapshotSandbox();
    const result = sandbox.run(false);
    expect(result.status).toBe(0);
    expect(snapshotWorktrees(sandbox)).toEqual([]);
  });

  it("removes a stale worktree from an earlier run before the next run", () => {
    sandbox = createSnapshotSandbox();
    const stale = join(sandbox.tmp, "rss-bridges-snapshot.STALE1");
    mkdirSync(stale);
    writeFileSync(join(stale, "the-christadelphian-posts.json"), "{}");
    sandbox.git("branch", "data", "refs/remotes/origin/data");
    sandbox.git("worktree", "add", join(stale, "data"), "data");
    expect(snapshotWorktrees(sandbox).length).toBeGreaterThan(0);

    const result = sandbox.run(false);
    expect({ status: result.status, stderr: result.stderr }).toMatchObject({ status: 0 });
    expect(result.stderr).toContain("Removing stale snapshot worktree");
    expect(snapshotWorktrees(sandbox)).toEqual([]);
    expect(existsSync(stale)).toBe(false);
  });

  it.each([
    ["outside TMPDIR with nested data", false, "rss-bridges-snapshot.something/extra"],
    ["outside TMPDIR with an exact name", false, "rss-bridges-snapshot.Ab12Z9"],
    ["nested data inside TMPDIR", true, "rss-bridges-snapshot.Ab12Z9/extra"],
    ["a short suffix", true, "rss-bridges-snapshot.A1234"],
    ["a long suffix", true, "rss-bridges-snapshot.A123456"],
    ["a non-alphanumeric suffix", true, "rss-bridges-snapshot.A1234_"],
  ])("preserves a data worktree with %s", (_label, insideTmp, relativeParent) => {
    sandbox = createSnapshotSandbox();
    const parent = join(insideTmp ? sandbox.tmp : sandbox.root, relativeParent);
    const decoy = join(parent, "data");
    const extra = join(parent, "keep.txt");
    mkdirSync(parent, { recursive: true });
    writeFileSync(extra, "unrelated parent file");
    sandbox.git("branch", "data", "refs/remotes/origin/data");
    sandbox.git("worktree", "add", decoy, "data");
    const uncommitted = join(decoy, "package.json");
    writeFileSync(uncommitted, "uncommitted work");

    // The decoy owns data, so Git must reject the publisher's branch reset.
    const result = sandbox.run(false);
    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain("Removing stale snapshot worktree");
    expect(sandbox.git("worktree", "list", "--porcelain")).toContain(
      `worktree ${realpathSync(decoy)}\n`,
    );
    expect(readFileSync(uncommitted, "utf8")).toBe("uncommitted work");
    expect(readFileSync(extra, "utf8")).toBe("unrelated parent file");
  });

  it("preserves unknown files in a stale task directory and reports rmdir failure", () => {
    sandbox = createSnapshotSandbox();
    const stale = join(sandbox.tmp, "rss-bridges-snapshot.Ab12Z9");
    mkdirSync(stale);
    const snapshot = join(stale, "the-christadelphian-posts.json");
    const extra = join(stale, "keep.txt");
    writeFileSync(snapshot, "{}");
    writeFileSync(extra, "unrelated file");
    sandbox.git("branch", "data", "refs/remotes/origin/data");
    sandbox.git("worktree", "add", join(stale, "data"), "data");

    const result = sandbox.run(false);
    expect({ status: result.status, stderr: result.stderr }).toMatchObject({ status: 0 });
    expect(snapshotWorktrees(sandbox)).toEqual([]);
    expect(existsSync(snapshot)).toBe(false);
    expect(readFileSync(extra, "utf8")).toBe("unrelated file");
    expect(result.stderr).toContain("Could not remove stale task directory");
  });
});
