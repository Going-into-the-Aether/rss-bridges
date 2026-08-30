#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";

function writeError(message) {
  process.stderr.write(`${message}\n`);
}

function usage(message) {
  if (message) writeError(message);
  writeError(
    "Usage: run-with-timeout.mjs --label <name> --timeout-seconds <seconds> -- <command> [args...]",
  );
  process.exit(2);
}

const separator = process.argv.indexOf("--");
if (separator === -1) usage("Missing command separator: --");

const options = process.argv.slice(2, separator);
const command = process.argv.slice(separator + 1);
let label = "command";
let timeoutSeconds;

for (let index = 0; index < options.length; index += 1) {
  const option = options[index];
  if (option === "--label") {
    label = options[++index];
  } else if (option === "--timeout-seconds") {
    timeoutSeconds = Number(options[++index]);
  } else {
    usage(`Unknown option: ${option}`);
  }
}

if (!label) usage("--label requires a value");
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
  usage("--timeout-seconds must be a positive number");
}
if (command.length === 0) usage("A command is required after --");

const child = spawn(command[0], command.slice(1), {
  detached: true,
  stdio: "inherit",
});
let timedOut = false;
let forceKillTimer;

function signalProcessGroup(signal) {
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

const timeout = setTimeout(() => {
  timedOut = true;
  signalProcessGroup("SIGTERM");
  forceKillTimer = setTimeout(() => signalProcessGroup("SIGKILL"), 1000);
}, timeoutSeconds * 1000);

child.once("error", (error) => {
  clearTimeout(timeout);
  writeError(`Failed to start ${label}: ${error.message}`);
  process.exitCode = 1;
});

child.once("close", (code, signal) => {
  clearTimeout(timeout);
  if (forceKillTimer) clearTimeout(forceKillTimer);
  if (timedOut) {
    const unit = timeoutSeconds === 1 ? "second" : "seconds";
    writeError(`Timed out after ${timeoutSeconds} ${unit}: ${label}`);
    process.exitCode = 124;
    return;
  }
  process.exitCode = code ?? (signal ? 1 : 0);
});
