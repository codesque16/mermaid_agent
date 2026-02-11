# Simple Mermaid Agent

A **simplified** version of the mermaid-agent framework:

- **One MCP tool:** `node_enter(node_id, input_data?)` — returns the node’s instructions from `nodes/{node_id}/index.md`.
- **Agent init on session start:** When the MCP server starts with `AGENT_PATH` set (e.g. in `.mcp.json`), that agent is loaded. No separate init tool.
- **Live visualizer:** When an agent is loaded, a browser window opens with the Mermaid graph; the current and visited nodes are highlighted as `node_enter` is called.
- **Agents live in `agents/`** and are **self-contained:** each has `agent-mermaid.md`, `nodes/<id>/index.md`, `.mcp.json`, and `CLAUDE.md` so Claude can be run from the agent directory.

## Layout

```
simple-mermaid-agent/
├── mcp-server/           # MCP server (one tool: node_enter) + live visualizer
│   ├── package.json
│   └── src/
│       ├── index.js
│       └── visualizer.html
├── .claude/skills/agent-builder-skill/   # Skill to build simple agents
│   ├── SKILL.md
│   └── references/dsl-spec.md
├── start-agent           # Script to write .mcp.json and optionally start Claude
├── CLAUDE.md.template    # Template for agent CLAUDE.md
└── README.md
```

Agents are created under **`agents/<name>/`** (see `agents/simple-echo/` for an example).

## Quick start

1. **Create an agent** (using the skill or by hand):
   - `agents/<name>/agent-mermaid.md` — Mermaid graph
   - `agents/<name>/nodes/<node_id>/index.md` — instructions per node
   - `agents/<name>/CLAUDE.md` — system prompt (copy from `CLAUDE.md.template` or skill output)

2. **Generate `.mcp.json` and start Claude** from the repo root:
   ```bash
   ./simple-mermaid-agent/start-agent agents/<name>
   ```
   This writes `agents/<name>/.mcp.json` (with `AGENT_PATH` and MCP path) and, if the `claude` CLI is in PATH, starts Claude from the agent directory with `CLAUDE.md` as the system prompt.

3. **Or run Claude yourself** from the agent directory after running `start-agent` once to create `.mcp.json`:
   ```bash
   cd agents/<name> && claude --append-system-prompt-file CLAUDE.md
   ```

## MCP server

- **Single tool:** `node_enter(node_id, input_data?)`
  - Returns: `{ node_id, has_instructions, instructions, input_data }`
  - `instructions` is the content of `nodes/<node_id>/index.md` (or a note if missing).
- **Initialization:** Agent is loaded at MCP session start when `AGENT_PATH` points to an agent directory that contains `agent-mermaid.md`.
- **Visualizer:** A local HTTP server serves a live view of the graph (SSE updates). A browser window opens automatically when the agent loads; it shows the current node and execution trace.

Install deps: `cd simple-mermaid-agent/mcp-server && npm install`

## Skill

The skill in `.claude/skills/agent-builder-skill/SKILL.md` describes how to build simple agents:

- Mermaid graph as the only flow definition
- One `index.md` per node (all instructions, guidelines, guardrails in text)
- Agents in `agents/`, self-contained with `.mcp.json` and `CLAUDE.md`

Copy or link the skill into your agent/skills directory (e.g. `.agent/skills/` or `.claude/skills/`) so your assistant can use it to create new agents.
