## Mermaid Agent Runtime

This repository contains the runtime and tooling for building and running graph-based agents with Claude using the Mermaid DSL.

### 1. Creating an agent (authoring phase)

To create a new agent:

- **Clone this repo** and open a terminal in the cloned directory.
- **Start a new Claude session from this directory.**  
  - The `agent-builder` skill will be auto-detected and loaded.
  - You can now chat with Claude to design and create an agent (the skill will walk you through requirements, graph design, and generation of the agent files).

When the skill finishes, you will have a new agent directory somewhere inside this repo (for example under an `agents/` folder, depending on how you configured it in the conversation).

### 2. Running an agent via MCP (execution phase)

After your agent is created:

- **Go to the `agent-session` directory** in this repo:
  - `cd agent-session`
- **Set the `AGENT_PATH` environment variable** to the absolute path of the newly created agent folder. For example:

```bash
export AGENT_PATH="/absolute/path/to/your/new-agent"
```

- **Start a new Claude session from the `agent-session` directory.**  
  - From that directory, open Claude with MCP support enabled (e.g., via a compatible client/editor).
  - The `agent-runtime-mcp` server will be picked up through `.mcp.json`, and Claude will be able to interact with your agent via MCP tools.

Now, in that Claude session, you can talk to the agent you created, and the runtime MCP will manage execution state, node transitions, and shared context according to your Mermaid graph.

