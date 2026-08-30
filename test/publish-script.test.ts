import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync("scripts/publish-christadelphian-snapshot.sh", "utf8");

describe("snapshot publisher transport boundaries", () => {
  it("uses a bounded public fetch but keeps changed snapshot pushes supervised", () => {
    expect(script).toContain('bounded_git "fetch origin data" fetch origin data');
    expect(script).not.toContain('supervised_git "fetch origin data"');
    expect(script).toContain(
      'supervised_git "push origin data" -C "$data_worktree" push origin data',
    );
  });
});
