import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

const runner = resolve("scripts/run-with-timeout.mjs");

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
  it("preserves a command's successful exit status", async () => {
    const result = await run([
      "--label",
      "test success",
      "--timeout-seconds",
      "2",
      "--",
      "/usr/bin/true",
    ]);

    expect(result).toEqual({ code: 0, stderr: "" });
  });

  it("times out a hanging command and terminates its process group", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rss-bridges-timeout-test."));
    const pidFile = join(directory, "child.pid");

    try {
      const result = await run([
        "--label",
        "test fetch",
        "--timeout-seconds",
        "1",
        "--",
        "/bin/sh",
        "-c",
        `echo $$ > ${JSON.stringify(pidFile)}; sleep 30`,
      ]);

      expect(result.code).toBe(124);
      expect(result.stderr).toContain("Timed out after 1 second: test fetch");

      const pid = Number.parseInt((await readFile(pidFile, "utf8")).trim(), 10);
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
