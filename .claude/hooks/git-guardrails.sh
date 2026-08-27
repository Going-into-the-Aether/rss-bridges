#!/bin/bash
# Blocks dangerous git commands before Claude Code executes them.
INPUT=$(cat)
CMD=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('command', ''))
except Exception:
    print('')
" 2>/dev/null)

DANGEROUS='(git[[:space:]]+(push[[:space:]]+(--force|-f\b)|reset[[:space:]]+--hard|clean[[:space:]]+(-f|--force)|branch[[:space:]]+-D|checkout[[:space:]]+--[[:space:]]))'

if echo "$CMD" | grep -qE "$DANGEROUS"; then
  echo "BLOCKED by git-guardrails: '$CMD' is a potentially destructive operation." >&2
  echo "Confirm explicitly with the user before proceeding." >&2
  exit 1
fi
exit 0
