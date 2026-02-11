#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_AGENT_DIR="${1:?Usage: setup.sh <absolute-path-to-agent-dir>}"
SOURCE_AGENT_DIR="$(cd "$SOURCE_AGENT_DIR" && pwd)"
AGENT_DIR="$SCRIPT_DIR/agent"

echo ""
echo "🔧 Agent Runner Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f "$SOURCE_AGENT_DIR/agent-mermaid.md" ]; then
    echo "❌ No agent-mermaid.md — this is the required source of truth."
    exit 1
fi
if [ ! -f "$SOURCE_AGENT_DIR/SYSTEM_PROMPT.md" ]; then
    echo "⚠️  No SYSTEM_PROMPT.md. Compile first: python agent_cli.py compile $SOURCE_AGENT_DIR"
fi

echo "✅ Source agent: $SOURCE_AGENT_DIR"

# Remove current agent folder and copy source agent into agent-session/agent
rm -rf "$AGENT_DIR"
cp -R "$SOURCE_AGENT_DIR" "$AGENT_DIR"
echo "✅ Agent folder updated: $AGENT_DIR"

cd "$SCRIPT_DIR/agent-runtime-mcp" && npm install --silent 2>/dev/null
echo "✅ MCP installed"

cd "$SCRIPT_DIR"

cat > ".mcp.json" << EOF
{
  "mcpServers": {
    "agent-runtime": {
      "command": "node",
      "args": ["$SCRIPT_DIR/agent-runtime-mcp/src/index.js"],
      "env": {
        "AGENT_PATH": "$AGENT_DIR"
      }
    }
  }
}
EOF
echo "✅ .mcp.json"

mkdir -p "$SCRIPT_DIR/.claude"
cat > "$SCRIPT_DIR/.claude/settings.local.json" << EOF
{
  "permissions": {
    "allow": ["mcp__agent-runtime__*"]
  },
  "enabledMcpjsonServers": ["agent-runtime"],
  "enableAllProjectMcpServers": true
}
EOF
echo "✅ .claude/settings.local.json"

cat > "./CLAUDE.md" << 'CLAUDEMD'
# Agent Runtime Instructions

You are a graph-based agent. Your behavior is defined by these files:

## Source of Truth

- **agent/agent-mermaid.md** — The execution graph. This is the PRIMARY source of truth.
- **agent/SYSTEM_PROMPT.md** — Compiled from graph + nodes. Read fully for identity, flow, and per-node instructions.
- **agent/nodes/{id}/index.md** — Detailed instructions per node.
- **agent/agent-config.yaml** — Model, tools, schemas.

## Startup

1. Read agent/SYSTEM_PROMPT.md completely
2. Wait for user input

## Execution Protocol

On every user message, traverse the graph from agent/agent-mermaid.md:

1. Execute the tool `node_enter(node_id, input_data, reason_to_enter_node)` if you want to go to a new node
2. The tool will return the instrcutions for that node which you will have to keep in mind while replying to the user

## Rules

- @cond on edges = when to take that path
- @pass on edges = what data to carry
- @max_iterations = loop limits (if hit, take exit path)
- human_input nodes: call request_human_input then STOP
- validator nodes: loop back if quality < threshold
- State persists across sessions automatically
- Live visualizer opens in browser showing current graph position
CLAUDEMD
echo "✅ CLAUDE.md"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 cd $SCRIPT_DIR && claude"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
