# Agent Framework — How to Run

## Overview

This framework has two phases:

```
PHASE 1: BUILD the agent    →    PHASE 2: RUN the agent
(You + Claude design it)         (Claude becomes the agent)
```

Phase 1 produces an agent directory. Phase 2 loads that directory into Claude.

---

## Phase 1: Building an Agent

### What Happens
You describe what you want. Claude (with the agent-builder skill loaded)
interviews you, designs a mermaid graph, creates all node files, compiles
a system prompt, validates, and iterates until you're happy.

### Method A: Claude.ai (Recommended)

**Setup (~2 minutes):**

1. Go to **claude.ai** → Create a new **Project**
2. In Project Knowledge, upload these files:
   ```
   skill/SKILL.md
   skill/references/dsl-spec.md
   skill/references/node-type-guide.md
   skill/references/interview-protocol.md
   skill/references/testing-guide.md
   parser.py
   compiler.py
   agent_cli.py
   ```
3. Start a conversation in the project

**Run:**
```
You: I want to build an agent that handles customer support tickets.
     It should classify the ticket, search our knowledge base, draft
     a response, and have a human approve before sending.

Claude: [interviews you, designs graph, builds everything]
```

Claude will:
1. Ask clarifying questions
2. Design the `agent-mermaid.md` graph and show you
3. Create each `nodes/*/index.md` with detailed instructions
4. Run `python agent_cli.py validate` to check for issues
5. Run `python agent_cli.py compile` to generate SYSTEM_PROMPT.md
6. Show you the visualization
7. Iterate based on your feedback

**Output:** An agent directory with all files, ready for Phase 2.

### Method B: Anthropic API

```bash
pip install anthropic
export ANTHROPIC_API_KEY=sk-ant-...
python run_phase1.py --api
```

Interactive terminal chat with Claude using the agent-builder skill.

### Method C: Claude Code

```bash
# Install Claude Code if you haven't
npm install -g @anthropic-ai/claude-code

# Navigate to the framework directory
cd agent-framework

# Start Claude Code and tell it to use the skill
claude
> Read skill/SKILL.md and all files in skill/references/. Then build me
  an agent that triages customer support tickets with escalation.
```

Claude Code has direct filesystem access — it creates all files without
needing bash tool workarounds.

---

## Phase 2: Running an Agent

### What Happens
Claude is loaded with the compiled SYSTEM_PROMPT.md. It now **IS** the agent.
Every message from the user triggers graph traversal — Claude enters nodes,
makes routing decisions, loops on quality checks, and delivers final output.

### Prerequisites
- A compiled agent (Phase 1 output)
- Specifically: `<agent-dir>/SYSTEM_PROMPT.md` must exist
- If not, compile first: `python agent_cli.py compile <agent-dir>`

### Method A: Claude.ai Project (Simplest — 1 minute setup)

1. Create a new **Project** in claude.ai
2. Open Project Settings → **Custom Instructions**
3. Paste the **entire contents** of `<agent-dir>/SYSTEM_PROMPT.md`
4. If the agent uses MCP servers (check `agent-config.yaml`), connect them
   in the Project's integrations settings
5. Start chatting — Claude IS the agent now

**Example with the research agent:**
```
# Copy the system prompt
cat examples/research-agent/SYSTEM_PROMPT.md | pbcopy

# Paste into a Claude.ai Project, then:
You: What are the latest developments in quantum error correction?

Claude: [follows the graph: intake → search → analyze → synthesize → review → deliver]
        [produces a structured research report with citations]
```

**Limitations of this method:**
- No explicit state tracking (Claude follows the graph via instructions only)
- No iteration enforcement (relies on Claude's attention)
- No sub-agent dispatch (handled inline)
- Works great for simple/medium agents; may drift on complex ones

### Method B: API with State Tracking (Recommended for Production)

```bash
pip install anthropic pyyaml
export ANTHROPIC_API_KEY=sk-ant-...

python run_phase2.py examples/research-agent --run
```

**What this does differently:**
- Loads SYSTEM_PROMPT.md + runtime protocol as system prompt
- Registers 7 runtime tools (node_enter, node_complete, route_decision, etc.)
- Manages state in Python (current node, iteration counts, shared context)
- Every tool call from Claude is processed and state is returned
- Full execution trace is recorded

**Interactive session looks like:**
```
🤖 Agent: research-agent
   Model: claude-sonnet-4-5-20250929
   Directory: /path/to/examples/research-agent
============================================================
Chat with the agent. Type 'quit' to exit, 'trace' to see execution trace.

You: What are the environmental impacts of lithium mining?
   ▸ Entering: intake (iteration 1)
   ▸ Route: intake → search [clarity >= 0.7]
   ▸ Entering: search (iteration 1)
   ▸ Route: search → analyze [unconditional]
   ▸ Entering: analyze (iteration 1)
   ▸ Route: analyze → synthesize [unconditional]
   ▸ Entering: synthesize (iteration 1)
   ▸ Route: synthesize → review [unconditional]
   ▸ Entering: review (iteration 1)
   ▸ Route: review → deliver [quality >= threshold]
   ▸ ✅ Agent execution complete (success)

Agent: # Environmental Impacts of Lithium Mining

## Executive Summary
Lithium mining has significant environmental consequences...

[structured report with citations]

You: trace
📊 Execution Trace:
   {'action': 'enter', 'node': 'intake', 'iteration': 1, ...}
   {'action': 'complete', 'node': 'intake', ...}
   {'action': 'route', 'from': 'intake', 'to': 'search', ...}
   ...
```

### Method C: Claude Code

```bash
claude --system-prompt examples/research-agent/SYSTEM_PROMPT.md
```

### Method D: Your Own Application

Use the Anthropic API directly with the agent's system prompt and tools:

```python
import anthropic

client = anthropic.Anthropic()

# Load the system prompt
with open("examples/research-agent/SYSTEM_PROMPT.md") as f:
    system_prompt = f.read()

# Add runtime protocol (see run_phase2.py for the full text)
system_prompt += RUNTIME_PROTOCOL

# Define the runtime tools (see run_phase2.py RUNTIME_TOOLS)
tools = [...]

# Make the call
response = client.messages.create(
    model="claude-sonnet-4-5-20250929",
    max_tokens=8192,
    system=system_prompt,
    messages=[{"role": "user", "content": "Your query here"}],
    tools=tools,
)

# Process tool calls in a loop (see run_phase2.py run_agent())
```

---

## Quick Start: End-to-End in 5 Minutes

```bash
# 1. Scaffold a new agent
python agent_cli.py scaffold my-agent

# 2. Edit the graph (or let Claude do it in Phase 1)
#    → edit my-agent/agent-mermaid.md
#    → create my-agent/nodes/*/index.md

# 3. Validate
python agent_cli.py validate my-agent

# 4. Compile
python agent_cli.py compile my-agent

# 5. Visualize
python agent_cli.py visualize my-agent

# 6. Run (pick one):
#    a) Paste SYSTEM_PROMPT.md into a Claude.ai Project
#    b) python run_phase2.py my-agent --run
#    c) claude --system-prompt my-agent/SYSTEM_PROMPT.md
```

---

## Using the Pre-Built Research Agent Example

```bash
# Already compiled — just run it:
python run_phase2.py examples/research-agent --run

# Or paste into Claude.ai:
cat examples/research-agent/SYSTEM_PROMPT.md
```

---

## File Reference

```
agent-framework/
├── run_phase1.py              # Phase 1 runner (build agents)
├── run_phase2.py              # Phase 2 runner (run agents)
├── agent_cli.py               # CLI: scaffold, validate, compile, visualize, inspect
├── parser.py                  # Mermaid DSL parser
├── compiler.py                # System prompt compiler
├── launch_agent.py            # Launch configuration generator
│
├── skill/                     # Agent-builder skill (Phase 1)
│   ├── SKILL.md               # Main skill file
│   └── references/            # DSL spec, node guide, interview protocol, testing
│
├── agent-runtime-mcp/         # Runtime MCP server (Phase 2, Method C)
│   ├── package.json
│   └── src/index.js
│
├── examples/
│   └── research-agent/        # Working example agent
│       ├── agent-mermaid.md
│       ├── agent-config.yaml
│       ├── index.md
│       ├── SYSTEM_PROMPT.md   # Pre-compiled
│       └── nodes/             # All node definitions
│
├── SPEC.md                    # Full DSL specification
└── ARCHITECTURE.md            # Two-phase architecture analysis
```
