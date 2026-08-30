import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const runner = resolve("scripts/run-with-timeout.mjs");
const execFileAsync = promisify(execFile);

function run(args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [runner, ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolveRun({ code, stderr }));
  });
}

describe("run-with-timeout", () => {
  it("preserves a successful Git operation's exit status", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rss-bridges-git-test."));

    try {
      await execFileAsync("/usr/bin/git", ["init", "--quiet", directory]);
      const result = await run([
        "--label",
        "test git status",
        "--timeout-seconds",
        "2",
        "--",
        "/usr/bin/git",
        "-C",
        directory,
        "status",
        "--short",
      ]);

      expect(result).toEqual({ code: 0, stderr: "" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports a command that cannot be spawned as exit 1", async () => {
    const result = await run([
      "--label",
      "missing command",
      "--timeout-seconds",
      "0.01",
      "--",
      "/definitely/not/a/command",
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Failed to start missing command:");
    expect(result.stderr).not.toContain("Timed out");
  });

  it("times out a hanging command and terminates its process group", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rss-bridges-timeout-test."));
    const pidFile = join(directory, "child.pid");
    const descendantPidFile = join(directory, "descendant.pid");

    try {
      const result = await run([
        "--label",
        "test fetch",
        "--timeout-seconds",
        "1",
        "--",
        "/bin/sh",
        "-c",
        `echo $$ > ${JSON.stringify(pidFile)}; /bin/sh -c 'echo $$ > ${descendantPidFile}; sleep 30' & wait`,
      ]);

      expect(result.code).toBe(124);
      expect(result.stderr).toContain("Timed out after 1 second: test fetch");

      const pid = Number.parseInt((await readFile(pidFile, "utf8")).trim(), 10);
      const descendantPid = Number.parseInt((await readFile(descendantPidFile, "utf8")).trim(), 10);
      expect(() => process.kill(pid, 0)).toThrow();
      expect(() => process.kill(descendantPid, 0)).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
