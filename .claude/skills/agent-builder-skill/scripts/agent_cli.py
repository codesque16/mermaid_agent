#!/usr/bin/env python3
"""
Agent Framework CLI

Commands:
  scaffold <name>     - Create a new agent from a template
  compile <dir>       - Compile SYSTEM_PROMPT.md from agent definition
  validate <dir>      - Validate agent structure and graph integrity
  visualize <dir>     - Show the agent graph summary
  inspect <dir>       - Deep inspect: show full graph + node details
"""

import sys
import os
import json
import yaml
from pathlib import Path
from parser import parse_mermaid, load_agent
from compiler import compile_and_write


def cmd_scaffold(name: str):
    """Create a new agent skeleton."""
    base = Path(name)
    if base.exists():
        print(f"❌ Directory '{name}' already exists")
        return

    # Create structure
    dirs = [
        base,
        base / "nodes",
        base / "shared" / "schemas",
        base / "shared" / "prompts",
        base / "runs",
    ]
    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)

    # agent-mermaid.md template
    (base / "agent-mermaid.md").write_text(f"""# {name} — Execution Graph

```mermaid
graph TD
    start(("START
    @type: terminal"))

    process["Process Input
    @type: executor"]

    done(("DONE
    @type: terminal"))

    start --> process
    process --> done
```
""")

    # agent-config.yaml
    (base / "agent-config.yaml").write_text(f"""name: {name}
version: "0.1.0"
description: "Describe your agent here"

defaults:
  model: claude-sonnet-4-5-20250929
  temperature: 0.3
  max_tokens: 4096

execution:
  mode: sequential
  max_total_time: 120s
  error_strategy: retry_then_escalate

context:
  shared_memory: true
  pass_history: false

mcp_servers: []

input_schema:
  type: object
  properties:
    input:
      type: string

output_schema:
  type: object
  properties:
    output:
      type: string
""")

    # index.md
    (base / "index.md").write_text(f"""# {name}

Describe your agent's purpose, personality, and core principles here.

## Core Principles
1. Principle one
2. Principle two

## Behavioral Rules
- Rule one
- Rule two
""")

    # Create a sample node
    node_dir = base / "nodes" / "process"
    node_dir.mkdir(parents=True)
    (node_dir / "index.md").write_text("""# Node: Process Input

## Role
Describe what this node does.

## System Instructions
Detailed instructions for this node's behavior.

## Input
- `input`: Description

## Output
- `output`: Description

## Constraints
- List constraints here
""")
    (node_dir / "references").mkdir()

    print(f"✅ Scaffolded agent: {base}")
    print(f"   Files created:")
    for f in sorted(base.rglob("*")):
        if f.is_file():
            print(f"   📄 {f.relative_to(base)}")
    print(f"\n   Next steps:")
    print(f"   1. Edit agent-mermaid.md to define your graph")
    print(f"   2. Create node folders in nodes/ for each graph node")
    print(f"   3. Run: python agent_cli.py compile {name}")


def cmd_compile(agent_dir: str):
    """Compile the system prompt."""
    path = Path(agent_dir)
    if not path.exists():
        print(f"❌ Directory '{agent_dir}' not found")
        return

    if not (path / "agent-mermaid.md").exists():
        print(f"❌ No agent-mermaid.md found in '{agent_dir}'")
        return

    print(f"🔨 Compiling agent: {agent_dir}")
    prompt = compile_and_write(agent_dir)
    print(f"\n📋 Preview (first 50 lines):")
    print("─" * 60)
    for line in prompt.split("\n")[:50]:
        print(f"  {line}")
    print("  ...")
    print("─" * 60)


def cmd_validate(agent_dir: str):
    """Validate agent structure."""
    path = Path(agent_dir)
    errors = []
    warnings = []

    # Check required files
    required = ["agent-mermaid.md", "agent-config.yaml", "index.md"]
    for f in required:
        if not (path / f).exists():
            errors.append(f"Missing required file: {f}")

    # Parse graph
    mermaid_file = path / "agent-mermaid.md"
    if mermaid_file.exists():
        content = mermaid_file.read_text()
        graph = parse_mermaid(content)

        # Check for start node
        if not graph.start_node:
            errors.append("No START node found in graph")

        # Check for terminal nodes
        if not graph.terminal_nodes:
            warnings.append("No terminal nodes found (besides START)")

        # Check that nodes have corresponding directories
        nodes_dir = path / "nodes"
        for node_id, node in graph.nodes.items():
            if node.node_type == "terminal":
                continue
            node_dir_name = node_id.replace("_", "-")
            if nodes_dir.exists():
                possible = [nodes_dir / node_id, nodes_dir / node_dir_name]
                if not any(p.exists() for p in possible):
                    warnings.append(f"Node '{node_id}' has no directory in nodes/")

        # Check for orphan nodes (no edges)
        sources = {e.source for e in graph.edges}
        targets = {e.target for e in graph.edges}
        connected = sources | targets
        for nid in graph.nodes:
            if nid not in connected:
                warnings.append(f"Node '{nid}' is disconnected from the graph")

        # Check for cycles (that aren't intentional loops)
        # Simple: just report loop edges
        for edge in graph.edges:
            if edge.max_iterations:
                pass  # Intentional loop
            # Check if edge creates a back-edge in topo sort
            topo = graph.topological_sort()
            if edge.source in topo and edge.target in topo:
                if topo.index(edge.source) > topo.index(edge.target):
                    if not edge.max_iterations and not edge.condition:
                        warnings.append(
                            f"Potential infinite loop: {edge.source} → {edge.target} "
                            f"(no @max_iterations or @cond)"
                        )

        print(f"\n📊 Graph Stats:")
        print(f"   Nodes: {len(graph.nodes)}")
        print(f"   Edges: {len(graph.edges)}")
        print(f"   Start: {graph.start_node}")
        print(f"   Terminals: {graph.terminal_nodes}")

    # Check node directories
    nodes_dir = path / "nodes"
    if nodes_dir.exists():
        for node_dir in sorted(nodes_dir.iterdir()):
            if node_dir.is_dir():
                if not (node_dir / "index.md").exists():
                    warnings.append(f"Node directory '{node_dir.name}' missing index.md")

                # Check for recursive sub-agents
                if (node_dir / "agent-mermaid.md").exists():
                    print(f"   📦 Sub-agent detected: {node_dir.name}")

    # Report
    print(f"\n{'='*50}")
    if errors:
        print(f"\n❌ ERRORS ({len(errors)}):")
        for e in errors:
            print(f"   • {e}")

    if warnings:
        print(f"\n⚠️  WARNINGS ({len(warnings)}):")
        for w in warnings:
            print(f"   • {w}")

    if not errors and not warnings:
        print(f"\n✅ Agent is valid! No issues found.")
    elif not errors:
        print(f"\n✅ Agent is valid (with warnings)")

    return len(errors) == 0


def cmd_visualize(agent_dir: str):
    """Show a text visualization of the agent graph."""
    path = Path(agent_dir)
    mermaid_file = path / "agent-mermaid.md"

    if not mermaid_file.exists():
        print(f"❌ No agent-mermaid.md in '{agent_dir}'")
        return

    content = mermaid_file.read_text()
    graph = parse_mermaid(content)
    config_file = path / "agent-config.yaml"
    config = yaml.safe_load(config_file.read_text()) if config_file.exists() else {}

    name = config.get("name", path.name)
    print(f"\n🤖 Agent: {name}")
    print(f"{'='*60}")

    topo = graph.topological_sort()
    for i, node_id in enumerate(topo):
        node = graph.nodes[node_id]
        children = graph.get_children(node_id)

        # Determine icon
        icons = {
            "terminal": "⭕",
            "router": "🔀",
            "executor": "⚙️",
            "validator": "✅",
            "aggregator": "📦",
            "human_input": "👤",
            "transformer": "🔄",
            "subagent": "🤖",
            "fork": "⑃",
        }
        icon = icons.get(node.node_type, "◻️")

        # Print node
        prefix = "├──" if i < len(topo) - 1 else "└──"
        model_str = f" [{node.model}]" if node.model else ""
        print(f"  {prefix} {icon} {node.display_name}{model_str}")

        # Print edges
        for j, edge in enumerate(children):
            target = graph.nodes.get(edge.target, None)
            target_name = target.display_name if target else edge.target
            edge_prefix = "│   ├→" if j < len(children) - 1 else "│   └→"

            cond_str = f" [{edge.condition}]" if edge.condition else ""
            pass_str = f" pass({edge.pass_fields})" if edge.pass_fields else ""
            print(f"  {edge_prefix} {target_name}{cond_str}{pass_str}")

    print(f"{'='*60}")


def cmd_inspect(agent_dir: str):
    """Deep inspection of the agent."""
    agent = load_agent(agent_dir)

    print(f"\n🔍 Agent Inspection: {agent_dir}")
    print(f"{'='*60}")

    if agent["config"]:
        print(f"\n📋 Config:")
        print(f"   Name: {agent['config'].get('name')}")
        print(f"   Version: {agent['config'].get('version')}")
        print(f"   Model: {agent['config'].get('defaults', {}).get('model')}")

    if agent["graph"]:
        g = agent["graph"]
        print(f"\n📊 Graph:")
        print(f"   Nodes: {len(g.nodes)}")
        print(f"   Edges: {len(g.edges)}")
        print(f"   Topo order: {' → '.join(g.topological_sort())}")

        print(f"\n🔹 Nodes:")
        for nid, node in g.nodes.items():
            print(f"   {nid}:")
            print(f"     type={node.node_type}, shape={node.shape}")
            if node.model:
                print(f"     model={node.model}")
            if nid in agent["nodes"]:
                nd = agent["nodes"][nid]
                has = []
                if nd.get("instructions"):
                    has.append("index.md")
                if nd.get("tools"):
                    has.append("tools.yaml")
                if nd.get("guardrails"):
                    has.append("guardrails.yaml")
                if nd.get("references"):
                    has.append(f"{len(nd['references'])} references")
                if nd.get("sub_agent"):
                    has.append("SUB-AGENT")
                print(f"     files: {', '.join(has)}")

    print(f"{'='*60}")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return

    cmd = sys.argv[1]
    args = sys.argv[2:]

    commands = {
        "scaffold": (cmd_scaffold, 1, "<name>"),
        "compile": (cmd_compile, 1, "<agent-dir>"),
        "validate": (cmd_validate, 1, "<agent-dir>"),
        "visualize": (cmd_visualize, 1, "<agent-dir>"),
        "inspect": (cmd_inspect, 1, "<agent-dir>"),
    }

    if cmd not in commands:
        print(f"❌ Unknown command: {cmd}")
        print(f"   Available: {', '.join(commands.keys())}")
        return

    func, n_args, usage = commands[cmd]
    if len(args) < n_args:
        print(f"Usage: python agent_cli.py {cmd} {usage}")
        return

    func(*args[:n_args])


if __name__ == "__main__":
    main()
