# Simple Mermaid Agent DSL

Minimal spec for the simple framework: one graph file, one instructions file per node.

## Agent structure

- **agent-mermaid.md** — One Mermaid diagram. Defines nodes and edges. Source of truth for flow.
- **nodes/{node_id}/index.md** — Instructions, guidelines, and guardrails for that node (plain text). Returned by the MCP tool `node_enter`.

## Node IDs

- Use valid Mermaid IDs: letters, numbers, underscores (e.g. `intake`, `classify`, `handle_request`).
- The MCP looks up `nodes/<node_id>/index.md` and also `nodes/<node_id_with_dashes>/index.md` (underscores replaced by hyphens).

## Optional labels on nodes

You can annotate nodes for readability (Claude reads the graph). Examples:

- Node labels in Mermaid: `intake["User intake"]`, `classify{"Classify intent"}` — the text in brackets is the optional label.
- On edges: `@pass: field1, field2` (what to pass to the next node), `@cond: expression` (condition for taking that edge).

None of these are required for the simple runtime; they help document the graph.

## Edge labels

- `source --> target`
- `source -->|"@cond: x == 1
  @pass: a, b"| target`

Multi-line labels in quotes are fine. The runner (Claude) uses the graph and `node_enter` only; no parser is required.

## Per-node index.md

Put everything that node needs in one place:

- Role / purpose
- Step-by-step instructions
- Inputs and outputs
- Constraints and guardrails
- Examples (optional)
