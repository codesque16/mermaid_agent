#!/bin/bash
set -e

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Agent Runner Setup
#
# Usage:
#   ./setup.sh <path-to-your-agent>
#
# Example:
#   ./setup.sh ./my-support-agent
#
# This script:
#   1. Installs the agent-runtime MCP server
#   2. Generates a .claude/settings.json that wires it up
#   3. Shows you how to start the agent
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_DIR="$SCRIPT_DIR"
AGENT_DIR="${1:-.}"

# Resolve to absolute path
AGENT_DIR="$(cd "$AGENT_DIR" && pwd)"

echo ""
echo "🔧 Agent Runner Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Check agent dir ──
if [ ! -f "$AGENT_DIR/SYSTEM_PROMPT.md" ]; then
    echo "❌ No SYSTEM_PROMPT.md found in $AGENT_DIR"
    echo "   Compile your agent first:"
    echo "   python agent_cli.py compile $AGENT_DIR"
    exit 1
fi

echo "✅ Agent found: $AGENT_DIR"
echo "   SYSTEM_PROMPT.md: $(wc -l < "$AGENT_DIR/SYSTEM_PROMPT.md") lines"

# ── Install runtime MCP ──
echo ""
echo "📦 Installing agent-runtime MCP server..."
cd "$RUNTIME_DIR"
npm install --silent 2>/dev/null
echo "✅ MCP server ready"

# ── Generate Claude Code settings ──
AGENT_NAME=$(python3 -c "
import yaml, sys
try:
    c = yaml.safe_load(open('$AGENT_DIR/agent-config.yaml'))
    print(c.get('name', 'agent'))
except: print('agent')
" 2>/dev/null || echo "agent")

SETTINGS_DIR="$AGENT_DIR/.claude"
mkdir -p "$SETTINGS_DIR"

cat > "$SETTINGS_DIR/settings.json" << SETTINGS_EOF
{
  "mcpServers": {
    "agent-runtime": {
      "command": "node",
      "args": ["$RUNTIME_DIR/src/index.js"],
      "env": {
        "AGENT_PATH": "$AGENT_DIR"
      }
    }
  }
}
SETTINGS_EOF

echo "✅ Claude Code settings written to $SETTINGS_DIR/settings.json"

# ── Generate CLAUDE.md ──
cat > "$AGENT_DIR/CLAUDE.md" << 'CLAUDE_EOF'
# Agent Execution Instructions

You are running as a graph-based agent. Your behavior is defined by SYSTEM_PROMPT.md.

## Startup

1. Read SYSTEM_PROMPT.md completely — it defines your identity, flow, and node instructions
2. Call `agent_init` with this directory's absolute path to initialize the runtime
3. Wait for the user's first message

## On Every User Message

Follow the graph defined in SYSTEM_PROMPT.md:

1. Call `node_enter` for the first node (after START) with any input data
2. Execute that node's instructions from SYSTEM_PROMPT.md
3. Call `node_complete` with your output
4. Call `route_decision` to pick the next node based on @cond edges
5. Repeat from step 1 for the next node
6. When you reach a terminal node, call `complete_execution`

## Rules

- ALWAYS use the runtime tools to track state — don't just follow instructions silently
- For `router` nodes: evaluate conditions, call `route_decision` with the matching @cond
- For `validator` nodes: score quality, loop back if below @threshold
- For `human_input` nodes: call `request_human_input`, then STOP and wait for the user
- If `node_enter` returns `iteration_limit_reached`, take the exit/fallback path
- Use `set_shared_context` / `get_shared_context` to pass data between non-adjacent nodes
CLAUDE_EOF

echo "✅ CLAUDE.md written"

# ── Done ──
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Ready! Run your agent with:"
echo ""
echo "   cd $AGENT_DIR"
echo "   claude"
echo ""
echo "   Claude Code will automatically:"
echo "   • Read CLAUDE.md for instructions"
echo "   • Connect to the agent-runtime MCP"
echo "   • Behave as your agent"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
