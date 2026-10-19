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
    -- "$git_wrapper" "$@" || return $?
}
# Why every caller adds "|| exit $?": under errexit, zsh leaves the shell
# WITHOUT running the EXIT trap when a function fails, whether the command
# failed inside the function or the function returned non-zero to top level.
# An explicit exit does run the trap. Without it, a rejected push left the data
# worktree registered (issue 39).

bounded_git() {
  local operation=$1
  shift
  GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/usr/bin/false SSH_ASKPASS=/usr/bin/false \
    node "$timeout_runner" \
    --label "$operation" \
    --timeout-seconds "$git_timeout_seconds" \
    -- git -c credential.helper= "$@" || return $?
}

task_root=$(mktemp -d "${TMPDIR:-/tmp}/rss-bridges-snapshot.XXXXXX")
snapshot_path="$task_root/the-christadelphian-posts.json"
data_worktree="$task_root/data"

cleanup() {
  local exit_code=$?
  if [[ -d "$data_worktree" ]] || git -C "$repo_root" worktree list --porcelain 2>/dev/null | grep -qxF "worktree $data_worktree"; then
    if ! git -C "$repo_root" worktree remove --force "$data_worktree"; then
      print -u2 "Cleanup: could not remove worktree $data_worktree; deleting the directory and pruning."
      rm -rf "$data_worktree" || print -u2 "Cleanup: could not delete $data_worktree"
      git -C "$repo_root" worktree prune || print -u2 "Cleanup: worktree prune failed"
    fi
  fi
  rm -f "$snapshot_path" || print -u2 "Cleanup: could not remove $snapshot_path"
  rmdir "$task_root" || print -u2 "Cleanup: could not remove $task_root"
  return $exit_code
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP

# (Do not name a local "path": in zsh it is tied to PATH.)
# Remove worktrees that an earlier run left behind. Only a worktree under a
# rss-bridges-snapshot.* directory that holds the data branch is touched.
remove_stale_snapshot_worktrees() {
  local line wt_path="" wt_branch="" stale
  local -a stale_paths
  for line in "${(@f)$(git -C "$repo_root" worktree list --porcelain)}" ""; do
    if [[ -z "$line" ]]; then
      if [[ "$wt_branch" == "refs/heads/data" && "$wt_path" == */rss-bridges-snapshot.*/data && "$wt_path" != "$data_worktree" ]]; then
        stale_paths+=("$wt_path")
      fi
      wt_path="" wt_branch=""
    elif [[ "$line" == "worktree "* ]]; then
      wt_path=${line#worktree }
    elif [[ "$line" == "branch "* ]]; then
      wt_branch=${line#branch }
    fi
  done
  for stale in "${stale_paths[@]}"; do
    print -u2 "Removing stale snapshot worktree: $stale"
    git -C "$repo_root" worktree remove --force --force "$stale" || { rm -rf "$stale" && git -C "$repo_root" worktree prune; } || return $?
    rm -rf "${stale:h}" || print -u2 "Could not delete stale task directory ${stale:h}"
  done
}

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
  "+refs/heads/data:refs/remotes/origin/data" || exit $?
git worktree prune
remove_stale_snapshot_worktrees || exit $?
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
supervised_git "push origin data" -C "$data_worktree" push origin data || exit $?
print "Published refreshed Christadelphian snapshot."
