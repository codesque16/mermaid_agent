# Mermaid Agent DSL — Quick Reference

## Node Syntax

```
node_id["Display Name
@type: executor | router | validator | aggregator | human_input | transformer | terminal | subagent
@model: claude-sonnet-4-5-20250929
@retry: 3
@timeout: 30s
@tools: tool-name
@threshold: 0.85
@max_iterations: 5
@strategy: merge | vote | first
@channel: slack | chat | email"]
```

Only `@type` is required. Everything else is optional.

## Edge Syntax

```
source -->|"@cond: expression
           @pass: field1, field2, field3
           @transform: expression
           @on_error: true
           @max_iterations: 5"| target
```

All annotations are optional. Plain `source --> target` is valid.

## Shapes

| Mermaid Syntax | Shape | Typical Use |
|---|---|---|
| `id(("text"))` | Double circle | START/END terminals |
| `id["text"]` | Rectangle | executor, validator, subagent |
| `id{"text"}` | Diamond | router (decisions) |
| `id{{"text"}}` | Hexagon | aggregator, fork |
| `id("text")` | Stadium | human_input |

## Parallel Execution

```mermaid
fork{{"Fork @type: fork"}} --> A & B & C
A & B & C --> join{{"Join @type: aggregator @strategy: merge"}}
```

## Loops

```mermaid
process --> check{"OK? @type: router"}
check -->|"@cond: quality < 0.8 @max_iterations: 5"| process
check -->|"@cond: quality >= 0.8"| done
```

## Directory Structure

```
my-agent/
├── agent-mermaid.md          # Graph definition
├── agent-config.yaml         # Config (model, tools, schemas)
├── SYSTEM_PROMPT.md          # AUTO-GENERATED
├── index.md                  # Agent purpose & principles
└── nodes/
    └── {node-id}/
        ├── index.md          # Node instructions
        ├── tools.yaml        # Tool definitions (optional)
        ├── guardrails.yaml   # Validation rules (optional)
        ├── references/       # Supporting docs (optional)
        ├── agent-mermaid.md  # ← Makes this node a sub-agent
        └── nodes/            # Sub-agent's nodes
```
