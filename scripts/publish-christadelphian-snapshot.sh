#!/bin/zsh
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
git_wrapper=${RSS_BRIDGES_GIT_WRAPPER:-}
commit_wrapper=${RSS_BRIDGES_COMMIT_WRAPPER:-}
timeout_runner="$repo_root/scripts/run-with-timeout.mjs"
git_timeout_seconds=${RSS_BRIDGES_GIT_TIMEOUT_SECONDS:-120}
public_data_remote="https://github.com/Going-into-the-Aether/rss-bridges.git"

if [[ -z "$git_wrapper" || ! -x "$git_wrapper" ]]; then
  print -u2 "RSS_BRIDGES_GIT_WRAPPER must name an executable supervised Git wrapper."
  exit 1
fi
if [[ -z "$commit_wrapper" || ! -x "$commit_wrapper" ]]; then
  print -u2 "RSS_BRIDGES_COMMIT_WRAPPER must name an executable commit-signing wrapper."
  exit 1
fi
if [[ ! -x "$repo_root/node_modules/.bin/tsx" ]]; then
  print -u2 "Dependencies are not installed. Run npm ci in $repo_root"
  exit 1
fi
if [[ ! -f "$timeout_runner" ]]; then
  print -u2 "Missing timeout runner: $timeout_runner"
  exit 1
fi

supervised_git() {
  local operation=$1
  shift
  node "$timeout_runner" \
    --label "$operation" \
    --timeout-seconds "$git_timeout_seconds" \
    -- "$git_wrapper" "$@"
}

bounded_git() {
  local operation=$1
  shift
  GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/usr/bin/false SSH_ASKPASS=/usr/bin/false \
    node "$timeout_runner" \
    --label "$operation" \
    --timeout-seconds "$git_timeout_seconds" \
    -- git -c credential.helper= "$@"
}

task_root=$(mktemp -d "${TMPDIR:-/tmp}/rss-bridges-snapshot.XXXXXX")
snapshot_path="$task_root/the-christadelphian-posts.json"
data_worktree="$task_root/data"

cleanup() {
  if [[ -d "$data_worktree" ]]; then
    git -C "$repo_root" worktree remove --force "$data_worktree" >/dev/null 2>&1 || true
  fi
  [[ -f "$snapshot_path" ]] && rm -f "$snapshot_path"
  rmdir "$task_root" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cd "$repo_root"
npm run snapshot:christadelphian -- --output="$snapshot_path"

origin_url=$(git remote get-url origin)
if [[ "$origin_url" != "$public_data_remote" ]]; then
  print -u2 "Origin must match the canonical public snapshot remote: $public_data_remote"
  exit 1
fi
bounded_git \
  "fetch public data branch" \
  fetch origin \
  "+refs/heads/data:refs/remotes/origin/data"
git worktree prune
if git show-ref --verify --quiet refs/heads/data; then
  git branch --force data refs/remotes/origin/data
else
  git branch data refs/remotes/origin/data
fi
git worktree add "$data_worktree" data
install -m 0644 "$snapshot_path" "$data_worktree/the-christadelphian-posts.json"

git -C "$data_worktree" add the-christadelphian-posts.json
if git -C "$data_worktree" diff --cached --quiet; then
  print "Snapshot content is unchanged."
  exit 0
fi

"$commit_wrapper" -C "$data_worktree" commit -m "data: refresh Christadelphian snapshot"
supervised_git "push origin data" -C "$data_worktree" push origin data
print "Published refreshed Christadelphian snapshot."
