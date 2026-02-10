# Node Type Guide

## executor

**Purpose:** Does work. Calls tools, generates content, transforms data.

**When to use:** Any step that actively produces output — writing, searching,
computing, transforming, formatting.

**Metadata:**
- `@model` — override the default model for this node
- `@tools` — specific tools this node needs
- `@retry` — number of retries on failure
- `@timeout` — maximum execution time

**index.md pattern:**
```markdown
## Role
[What this node does in one sentence]

## System Instructions
[Detailed step-by-step instructions. Be specific. Include examples.]

## Input
[List every field from incoming @pass edges]

## Output
[List every field this node produces — must match outgoing @pass edges]
```

---

## router

**Purpose:** Makes decisions and routes to different paths.

**When to use:** Any point where the agent needs to choose between 2+
different next steps based on the input or context.

**Metadata:**
- `@model` — fast models (Haiku) work well for classification
- `@retry` — rarely needed, routing decisions should be deterministic

**Edge requirements:** EVERY outgoing edge MUST have `@cond`.
One edge can be the default (use `@cond: else` or `@fallback: true`).

**index.md pattern:**
```markdown
## Role
Classify [what] and route to appropriate handler.

## System Instructions
Evaluate the input and determine which category it belongs to:
- **Category A**: [criteria] → route to node_a
- **Category B**: [criteria] → route to node_b
- **Default**: [criteria] → route to fallback

Output your classification and confidence.

## Output
- `category`: string — the classification result
- `confidence`: float 0-1 — how certain the classification is
- `reasoning`: string — brief explanation
```

---

## validator

**Purpose:** Quality gate. Checks if output meets standards.

**When to use:** After any executor that produces user-facing output.
Especially important before terminal nodes.

**Metadata:**
- `@threshold` — minimum quality score to pass (0-1)
- `@max_iterations` — how many times to loop back before giving up

**Edge pattern:** Always has at least two outgoing edges:
1. `@cond: quality >= threshold` → next step (pass)
2. `@cond: quality < threshold` → loop back (fail)
3. Optional: `@cond: iterations >= max` → force continue with warnings

**index.md pattern:**
```markdown
## Role
Review [what] for quality and correctness.

## System Instructions
Score the input on these dimensions:
1. [Dimension 1] (weight: 0.X): [criteria]
2. [Dimension 2] (weight: 0.X): [criteria]

Weighted quality = Σ(score × weight)

If quality < threshold, provide SPECIFIC feedback:
- Which parts are weak
- What needs to change
- Concrete suggestions

## Output
- `quality`: float 0-1
- `approved`: boolean
- `feedback`: string (if not approved)
```

---

## aggregator

**Purpose:** Combines outputs from parallel branches.

**When to use:** After a fork (parallel execution) to merge results.

**Metadata:**
- `@strategy` — how to combine:
  - `merge` — combine all outputs into one (default)
  - `vote` — take majority/highest-scored result
  - `first` — take whichever finishes first

**index.md pattern:**
```markdown
## Role
Combine results from parallel [what] branches.

## System Instructions
Strategy: [merge/vote/first]

For merge:
- Deduplicate overlapping results
- Resolve conflicts by [rule]
- Rank by [criteria]

## Input
- Results from all parallel branches

## Output
- `merged_results`: combined output
- `sources`: which branches contributed what
```

---

## human_input

**Purpose:** Pauses execution and waits for human input.

**When to use:** Approval gates, clarification requests, feedback loops.

**Metadata:**
- `@channel` — how to reach the human (chat, slack, email)

**Behavior:** When the agent reaches this node, it should:
1. Present what it has so far
2. Clearly state what it needs from the human
3. Offer options if possible (approve/reject/modify)
4. Wait for response before continuing

**index.md pattern:**
```markdown
## Role
Request human [approval/input/clarification] for [what].

## System Instructions
Present the current state clearly:
- What has been done so far
- What decision is needed
- Options available: [list]
- What happens for each option

Keep it concise. The human's time is valuable.

## Input
- [What to present to the human]

## Output
- `decision`: the human's choice
- `feedback`: any additional input
```

---

## subagent

**Purpose:** Delegates to a fully recursive child agent.

**When to use:** When a node is complex enough to warrant its own graph.
Rule of thumb: if a node would need more than 3 paragraphs of instructions,
it might be better as a sub-agent.

**Metadata:**
- `@model` — model for the sub-agent
- `@timeout` — max time for the entire sub-agent execution
- `@retry` — retries for the sub-agent as a whole

**Directory structure:** The node folder contains a full agent:
```
nodes/my-subagent/
├── index.md              # Brief description (the "why")
├── agent-mermaid.md      # Sub-agent's own graph
├── agent-config.yaml     # Sub-agent's config
├── SYSTEM_PROMPT.md      # Auto-compiled
└── nodes/                # Sub-agent's own nodes
```

---

## transformer

**Purpose:** Reshapes data between nodes without making decisions.

**When to use:** When the output format of one node doesn't match
the input format of the next. Data cleaning, format conversion,
field mapping.

**index.md pattern:**
```markdown
## Role
Transform [source format] into [target format].

## System Instructions
Map fields:
- source.field_a → target.field_x
- source.field_b → target.field_y (apply: [transformation])

## Input
[Source schema]

## Output
[Target schema]
```

---

## terminal

**Purpose:** Start and end points of the graph.

**No index.md needed.** Terminal nodes are structural markers.

Use `(("START"))` and `(("END"))` or `(("DELIVER"))` shapes in mermaid.
