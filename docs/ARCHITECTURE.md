# Agent Framework: Two-Phase Architecture & Tool Analysis

## The Two Phases

```
┌─────────────────────────────────────────────────────────────────────┐
│  PHASE 1: AUTHORING (Claude Chat + Skill)                          │
│                                                                     │
│  Human ←→ Claude (with agent-builder skill)                        │
│     "Build me an agent that does X"                                │
│     → Interview → Graph Design → Node Authoring → Test → Compile   │
│     → Output: agent directory with SYSTEM_PROMPT.md                │
│                                                                     │
│  Tools needed: File creation, bash (existing)                      │
│  New: agent-framework MCP (validate, compile, test, visualize)     │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  PHASE 2: EXECUTION (New Claude Session as the Agent)              │
│                                                                     │
│  Human ←→ Claude (loaded with SYSTEM_PROMPT.md)                    │
│     Claude IS the agent now. It follows the graph.                 │
│     It has the agent's tools, personality, and constraints.        │
│                                                                     │
│  Tools needed: Agent's own MCP servers + agent-runtime MCP         │
│  New: Runtime state tracking, node transitions, sub-agent dispatch │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Authoring — What's Needed

### The Skill: `agent-builder`

This is a Claude skill (like skill-creator) that guides a user through
building an agent in our DSL format. It needs the SPEC baked in and
follows an interview → design → implement → test → compile loop.

**Already have (from existing Claude capabilities):**
- File creation (create agent-mermaid.md, index.md, tools.yaml, etc.)
- Bash execution (run the CLI: validate, compile)
- Conversation with user (interview, iterate)

**What the skill provides:**
- Knowledge of the DSL format (node types, edge annotations, directory structure)
- Interview protocol (what questions to ask to extract graph topology)
- Compilation rules (how to generate SYSTEM_PROMPT.md)
- Test patterns (how to dry-run an agent)
- Visual feedback (show the graph to user, get approval)

### The MCP Server: `agent-framework-mcp`

This is the missing piece. The skill needs a tool interface for the
heavy lifting that shouldn't be done through bash scripts:

```
agent-framework-mcp
├── Tools:
│   ├── agent_scaffold     — Create new agent directory structure
│   ├── agent_validate     — Validate graph integrity, missing files, loops
│   ├── agent_compile      — Generate SYSTEM_PROMPT.md from graph + nodes
│   ├── agent_visualize    — Return text/mermaid visualization
│   ├── agent_inspect      — Deep inspection of agent structure
│   ├── agent_add_node     — Add a node to existing agent (files + graph update)
│   ├── agent_add_edge     — Add an edge between nodes
│   ├── agent_test_node    — Dry-run a single node with sample input
│   ├── agent_test_flow    — Simulate full flow with mock data
│   └── agent_export       — Package agent for Phase 2 deployment
│
├── Resources:
│   ├── spec://dsl          — The full DSL specification
│   ├── spec://node-types   — Node type reference
│   ├── spec://examples     — Example agents
│   └── template://{type}   — Templates for each node type
│
└── Prompts:
    ├── interview-start     — Initial questions to ask user
    ├── graph-review        — Prompt to review a designed graph
    └── node-design         — Prompt to design a specific node
```

**Why an MCP and not just bash scripts?**
1. Structured input/output — tools return JSON, not stdout strings
2. Atomic operations — `agent_add_node` updates both the graph AND creates the directory
3. Validation on every mutation — can't create an invalid agent
4. Stateful operations — `agent_test_flow` needs to track execution state
5. Resource access — Claude can pull in the DSL spec via MCP resources

---

## Phase 2: Execution — What's Needed

This is the harder problem. When we "initialize a Claude session with the agent",
Claude needs to actually BEHAVE like the agent — follow the graph, execute nodes
in order, track state, handle routing decisions, loop back on failures, etc.

### Option A: Pure System Prompt (Simplest)

Just load SYSTEM_PROMPT.md as the system prompt. Claude follows it as instructions.

**Pros:** Zero infrastructure. Works today.
**Cons:**
- Claude may drift from the graph over long conversations
- No enforced state tracking (which node are we on?)
- No sub-agent dispatch (can't spawn a separate Claude call)
- No parallel execution
- Tools from tools.yaml aren't actually connected

**Best for:** Simple linear agents, prototyping.

### Option B: System Prompt + Agent Runtime MCP (Recommended)

Load SYSTEM_PROMPT.md AND give Claude an `agent-runtime-mcp` that
provides state management and execution infrastructure.

```
agent-runtime-mcp
├── Tools:
│   ├── node_enter          — Declare entering a node (logs, validates input)
│   ├── node_complete       — Declare completing a node (validates output, routes)
│   ├── route_decision      — Record a routing decision with rationale
│   ├── get_state           — Get current execution state (node, history, data)
│   ├── set_context         — Store data in shared context between nodes
│   ├── get_context         — Retrieve from shared context
│   ├── spawn_subagent      — Dispatch a sub-agent (creates new Claude API call)
│   ├── await_subagent      — Check/wait for sub-agent result
│   ├── request_human_input — Pause and ask user for input
│   ├── emit_output         — Send intermediate output to user
│   └── complete_agent      — Mark agent execution as complete
│
├── State Management:
│   ├── Current node in graph
│   ├── Execution history (which nodes visited, in what order)
│   ├── Data flowing between nodes (the @pass fields)
│   ├── Iteration counters (for loops with @max_iterations)
│   ├── Error stack
│   └── Shared context (cross-node memory)
│
└── Sub-Agent Dispatch:
    ├── Creates new Anthropic API call with sub-agent's SYSTEM_PROMPT.md
    ├── Passes input data from parent edge
    ├── Collects output and routes back to parent graph
    └── Handles timeout and retry per sub-agent config
```

**Why this is necessary:**

1. **State tracking** — Without explicit state, Claude forgets which node it's
   on in long conversations. `node_enter`/`node_complete` make the graph
   execution observable and enforceable.

2. **Sub-agent dispatch** — The `search` node in our research agent is a
   sub-agent. To actually run it, we need to make a NEW Claude API call
   with the search sub-agent's SYSTEM_PROMPT.md. This requires server-side
   orchestration.

3. **Data routing** — `@pass: query, entities, scope` means we need to
   actually extract those fields from one node's output and inject them
   into the next node's input. The runtime MCP does this.

4. **Loop control** — `@max_iterations: 3` needs a counter. The runtime
   tracks this and enforces it.

5. **Human-in-the-loop** — `human_input` nodes need to actually pause
   execution and wait for the user. The runtime manages this pause/resume.

### Option C: Full Orchestrator (Most Powerful)

A separate orchestration server that drives Claude. Instead of Claude
deciding which node to execute next, the orchestrator reads the graph
and makes API calls to Claude for each node individually.

```
Orchestrator Server
├── Reads agent-mermaid.md graph
├── For each node:
│   │   Creates Claude API call with:
│   │   - Node's index.md as system prompt
│   │   - Input data from previous node
│   │   - Node's tools from tools.yaml
│   │   Collects output
│   │   Evaluates edge conditions
│   │   Routes to next node
│   │
├── Handles parallel execution (fork/join)
├── Manages sub-agent recursion
├── Enforces timeouts, retries, guardrails
└── Streams results back to user
```

**Pros:** Maximum control, true parallelism, each node gets clean context.
**Cons:** Complex infrastructure, latency per node, loses conversational flow.
**Best for:** Production systems, complex multi-model agents.

---

## Recommendation: Start with Option B

The MCP approach gives us 80% of the power of full orchestration while
keeping the conversational UX of Claude chat.

### What to Build

#### 1. `agent-builder` Skill (for Phase 1)

```
/mnt/skills/user/agent-builder/
├── SKILL.md                    — The main skill file
├── references/
│   ├── dsl-spec.md             — Full DSL specification
│   ├── node-type-guide.md      — Detailed guide per node type
│   ├── interview-protocol.md   — How to interview users
│   ├── testing-guide.md        — How to test agents
│   └── examples/               — Example agents to reference
├── scripts/
│   ├── scaffold.py             — Create agent directory
│   ├── compile.py              — Generate SYSTEM_PROMPT.md
│   ├── validate.py             — Validate agent structure
│   └── visualize.py            — Text visualization
└── templates/
    ├── node-index.md           — Template for node index.md
    ├── agent-config.yaml       — Template config
    └── guardrails.yaml         — Template guardrails
```

#### 2. `agent-runtime-mcp` Server (for Phase 2)

TypeScript MCP server that provides execution infrastructure:

```typescript
// Core tools the runtime MCP exposes
tools: [
  "node_enter",           // { node_id, input_data }
  "node_complete",        // { node_id, output_data }
  "route_decision",       // { from_node, to_node, condition_met, rationale }
  "get_execution_state",  // {} → { current_node, history, iteration_counts }
  "set_shared_context",   // { key, value }
  "get_shared_context",   // { key } → { value }
  "spawn_subagent",       // { agent_path, input_data } → { job_id }
  "get_subagent_result",  // { job_id } → { status, output_data }
  "request_human_input",  // { prompt, options } → pauses execution
  "complete_execution",   // { final_output, status }
]
```

#### 3. `agent-framework-mcp` Server (for Phase 1, optional but nice)

TypeScript MCP that wraps the CLI tools with structured I/O:

```typescript
tools: [
  "scaffold_agent",       // { name, template? }
  "add_node",             // { agent_path, node_id, type, instructions }
  "add_edge",             // { agent_path, from, to, condition?, pass? }
  "remove_node",          // { agent_path, node_id }
  "compile_agent",        // { agent_path } → { system_prompt, stats }
  "validate_agent",       // { agent_path } → { valid, errors, warnings }
  "visualize_agent",      // { agent_path } → { text_viz, mermaid_source }
  "test_agent_flow",      // { agent_path, input } → { trace, output }
]
```

---

## The Initialization Flow (Phase 1 → Phase 2)

```
Phase 1 (Building):
  User: "Build me a customer support agent"
  Claude + agent-builder skill:
    1. Interviews user about requirements
    2. Designs the mermaid graph
    3. Creates node folders + instructions
    4. Compiles SYSTEM_PROMPT.md
    5. Tests with sample inputs
    6. Exports the agent package

       ↓ agent package (directory with all files)

Phase 2 (Running):
  System loads:
    - SYSTEM_PROMPT.md as Claude's system prompt
    - agent-runtime-mcp connected as tool
    - All MCP servers from agent-config.yaml connected
    - Agent's tools from tools.yaml registered

  User: "I have a billing issue with my last order"
  Claude (AS the customer support agent):
    1. Calls node_enter("classify")
    2. Classifies intent → complaint
    3. Calls node_complete("classify", {intent: "complaint"})
    4. Calls route_decision("classify", "sentiment", "intent == complaint")
    5. Calls node_enter("sentiment")
    6. ... follows the graph ...
```

---

## Summary: What Needs Building

| Component | Type | Priority | Purpose |
|-----------|------|----------|---------|
| `agent-builder` skill | Skill (SKILL.md) | **P0** | Guide agent creation in chat |
| `compile.py` + friends | Python scripts | **P0** | Core tooling (already built) |
| `agent-runtime-mcp` | MCP Server (TS) | **P0** | Execution state for Phase 2 |
| `agent-framework-mcp` | MCP Server (TS) | P1 | Structured authoring tools |
| Orchestrator server | Standalone service | P2 | Full production orchestration |

The **minimum viable system** is: skill + Python scripts + runtime MCP.
