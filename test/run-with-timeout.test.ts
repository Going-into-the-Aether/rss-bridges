import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const runner = resolve("scripts/run-with-timeout.mjs");
const execFileAsync = promisify(execFile);

function killProcessGroup(processGroupId: number): void {
  try {
    process.kill(-processGroupId, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function run(
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [runner, ...args], {
      env: environment,
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

async function readPidWhenReady(path: string): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return Number.parseInt((await readFile(path, "utf8")).trim(), 10);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await delay(10);
    }
  }
  throw new Error(`PID file was not created: ${path}`);
}

async function expectProcessGone(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      process.kill(pid, 0);
      await delay(10);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
  }
  throw new Error(`Process remained after timeout cleanup: ${pid}`);
}

describe("run-with-timeout", () => {
  it("preserves a successful Git operation's exit status", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rss-bridges-git-test."));
    const gitEnvironment = {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    };

    try {
      await execFileAsync("git", ["init", "--quiet", directory], {
        env: gitEnvironment,
      });
      const result = await run(
        [
          "--label",
          "test git status",
          "--timeout-seconds",
          "2",
          "--",
          "git",
          "-C",
          directory,
          "status",
          "--short",
        ],
        gitEnvironment,
      );

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
    const hangingCommand = join(directory, "hang.sh");
    let processGroupId;

    try {
      await writeFile(
        hangingCommand,
        [
          "#!/bin/sh",
          `echo $$ > ${JSON.stringify(pidFile)}`,
          "trap 'exit 0' TERM",
          `/bin/sh -c 'trap "" TERM; echo $$ > "$1"; while :; do sleep 1; done' child ${JSON.stringify(descendantPidFile)} &`,
          "wait",
        ].join("\n"),
      );
      await chmod(hangingCommand, 0o700);

      const resultPromise = run([
        "--label",
        "test fetch",
        "--timeout-seconds",
        "1",
        "--",
        hangingCommand,
      ]);
      processGroupId = await readPidWhenReady(pidFile);
      const descendantPid = await readPidWhenReady(descendantPidFile);
      const result = await resultPromise;

      expect(result.code).toBe(124);
      expect(result.stderr).toContain("Timed out after 1 second: test fetch");
      await expectProcessGone(processGroupId);
      await expectProcessGone(descendantPid);
    } finally {
      if (processGroupId) killProcessGroup(processGroupId);
      await rm(directory, { recursive: true, force: true });
    }
  }, 7000);
});
