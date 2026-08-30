#!/bin/zsh
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
uah_root=${UAH_ROOT:-"$HOME/Developer/UAH"}
git_wrapper="$uah_root/scripts/git-uah.sh"
timeout_runner="$repo_root/scripts/run-with-timeout.mjs"
git_timeout_seconds=${RSS_BRIDGES_GIT_TIMEOUT_SECONDS:-120}

if [[ ! -x "$git_wrapper" ]]; then
  print -u2 "Missing supervised Git wrapper: $git_wrapper"
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

supervised_git "fetch origin data" fetch origin data
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

git -C "$data_worktree" commit -S -m "data: refresh Christadelphian snapshot"
supervised_git "push origin data" -C "$data_worktree" push origin data
print "Published refreshed Christadelphian snapshot."
