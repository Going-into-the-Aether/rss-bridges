#!/bin/bash
# Blocks dangerous git commands before Claude Code executes them.
INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
tool_input = d.get('tool_input', {})
command = tool_input.get('command', d.get('command', ''))
if not isinstance(command, str):
    raise TypeError('command must be a string')
print(command)
" 2>/dev/null)
PARSE_STATUS=$?

if [[ $PARSE_STATUS -ne 0 ]]; then
  echo "BLOCKED by git-guardrails: could not parse the hook payload safely." >&2
  exit 2
fi

DANGEROUS='(git[[:space:]]+push[^;&|]*(-[^[:space:]]*f|--force([^[:space:]]*)?)([[:space:]]|$)|git[[:space:]]+reset[^;&|]*--hard([[:space:]]|$)|git[[:space:]]+clean[^;&|]*(-[^[:space:]]*f|--force)|git[[:space:]]+branch[[:space:]]+-D|git[[:space:]]+checkout[^;&|]*(-[^[:space:]]*f|--force)|git[[:space:]]+checkout[[:space:]]+(--([[:space:]]|$)|\.([[:space:]]|$)))'

if echo "$CMD" | grep -qE "$DANGEROUS"; then
  echo "BLOCKED by git-guardrails: '$CMD' is a potentially destructive operation." >&2
  echo "Confirm explicitly with the user before proceeding." >&2
  exit 2
fi
exit 0
