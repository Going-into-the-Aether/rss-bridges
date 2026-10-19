import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface SnapshotSandbox {
  root: string;
  repo: string;
  tmp: string;
  run(pushFails: boolean): ReturnType<typeof spawnSync>;
  git(...args: string[]): string;
}

// Ignore the caller's Git config, so signing, hooks and other operator
// settings cannot fail or block the fixture commits. That includes config
// injected through the environment (GIT_CONFIG_COUNT/KEY_n/VALUE_n and
// GIT_CONFIG_PARAMETERS), which overrides both global and system files.
const isolatedGitEnv: NodeJS.ProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/.test(key),
  ),
);
Object.assign(isolatedGitEnv, {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
});

function sh(cwd: string, cmd: string, args: string[]): string {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8", env: isolatedGitEnv });
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

/** A throwaway repo with a local bare "origin". It never touches the network or the real data branch. */
export function createSnapshotSandbox(): SnapshotSandbox {
  const root = mkdtempSync(join(tmpdir(), "rss-bridges-sandbox-"));
  const remote = join(root, "remote.git");
  const repo = join(root, "repo");
  const tmp = join(root, "tmp");
  const resolvedTmp = join(root, "resolved-tmp");
  mkdirSync(resolvedTmp);
  // Exercise TMPDIR aliases such as macOS /var versus Git's /private/var paths.
  symlinkSync(resolvedTmp, tmp, "dir");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(join(repo, "node_modules/.bin"), { recursive: true });
  sh(root, "git", ["init", "-q", "--bare", remote]);
  sh(repo, "git", ["init", "-q", "-b", "main"]);
  sh(repo, "git", ["config", "user.email", "test@example.invalid"]);
  sh(repo, "git", ["config", "user.name", "test"]);
  writeFileSync(join(repo, "node_modules/.bin/tsx"), "");
  chmodSync(join(repo, "node_modules/.bin/tsx"), 0o755);
  copyFileSync("scripts/run-with-timeout.mjs", join(repo, "scripts/run-with-timeout.mjs"));
  const script = readFileSync("scripts/publish-christadelphian-snapshot.sh", "utf8").replace(
    /^public_data_remote=.*$/m,
    `public_data_remote="${remote}"`,
  );
  writeFileSync(join(repo, "scripts/publish-christadelphian-snapshot.sh"), script, { mode: 0o755 });
  writeFileSync(
    join(repo, "snap.js"),
    "const a=process.argv.find(x=>x.startsWith('--output='));" +
      "require('fs').writeFileSync(a.slice(9),JSON.stringify({t:Date.now()+Math.random()}));\n",
  );
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({ scripts: { "snapshot:christadelphian": "node snap.js" } }),
  );
  sh(repo, "git", ["add", "."]);
  sh(repo, "git", ["commit", "-q", "-m", "init"]);
  sh(repo, "git", ["remote", "add", "origin", remote]);
  sh(repo, "git", ["push", "-q", "origin", "main", "main:data"]);

  const okGit = join(root, "ok-git.sh");
  const badGit = join(root, "bad-git.sh");
  const commit = join(root, "commit.sh");
  writeFileSync(okGit, '#!/bin/sh\nexec git "$@"\n', { mode: 0o755 });
  writeFileSync(
    badGit,
    '#!/bin/sh\ncase "$*" in *push*) echo "push rejected" >&2; exit 1;; esac\nexec git "$@"\n',
    { mode: 0o755 },
  );
  writeFileSync(commit, '#!/bin/sh\nexec git "$@"\n', { mode: 0o755 });

  return {
    root,
    repo,
    tmp,
    git: (...args) => sh(repo, "git", args),
    run: (pushFails) =>
      spawnSync("/bin/zsh", ["scripts/publish-christadelphian-snapshot.sh"], {
        cwd: repo,
        encoding: "utf8",
        env: {
          ...isolatedGitEnv,
          TMPDIR: tmp,
          RSS_BRIDGES_GIT_WRAPPER: pushFails ? badGit : okGit,
          RSS_BRIDGES_COMMIT_WRAPPER: commit,
        },
      }),
  };
}
