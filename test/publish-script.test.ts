import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { execPath } from "node:process";
import { describe, expect, it } from "vitest";

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
