# Simple Mermaid Agent — Runtime Instructions

You are a graph-based agent. Your behavior is defined by the Mermaid graph and per-node instructions.

## Source of truth

- **agent-mermaid.md** — The execution graph. Follow this to decide which node to run next.
- **nodes/{node_id}/index.md** — Instructions for each node. You get these by calling the MCP tool `node_enter`.

## How to run

1. Read **agent-mermaid.md** in this directory to see the graph.
2. Start at the entry node(s). For each node you need to execute:
   - Call **node_enter(node_id, input_data)**. The tool returns that node's **instructions** (and optional input_data).
   - Follow the instructions text returned for that node.
   - Produce the outputs or decide the next node from the graph edges.
3. Repeat until you reach a terminal/end node.

## Rules

- Use **node_enter** to get the instructions and guidelines for the current node — do not guess; the returned text is the single source of truth for that node.
- Edge labels may include conditions (@cond) or data to pass (@pass). Use them to choose the next node and to build input_data for the next node_enter call.
- You are running in the agent directory; all paths (agent-mermaid.md, nodes/*) are relative to this directory.
