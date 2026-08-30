import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync("scripts/publish-christadelphian-snapshot.sh", "utf8");

describe("snapshot publisher transport boundaries", () => {
  it("uses a bounded public fetch but keeps changed snapshot pushes supervised", () => {
    expect(script).toContain(
      'public_data_remote="https://github.com/Going-into-the-Aether/rss-bridges.git"',
    );
    expect(script).toContain('fetch "$public_data_remote"');
    expect(script).toContain('"+refs/heads/data:refs/remotes/origin/data"');
    expect(script).not.toContain('supervised_git "fetch public data branch"');
    expect(script).toContain(
      'supervised_git "push origin data" -C "$data_worktree" push origin data',
    );
  });
});
