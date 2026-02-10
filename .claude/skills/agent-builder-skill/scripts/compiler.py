"""
System Prompt Compiler

Takes a parsed agent graph + node definitions + config and generates
a complete SYSTEM_PROMPT.md that Claude can use to execute the agent.

The generated prompt follows a specific structure:
1. Identity & Purpose
2. Execution Graph (natural language)
3. Node-by-Node Instructions (topological order)
4. Tool Definitions
5. Data Contracts
6. Guardrails & Constraints
7. Error Handling
"""

import json
import yaml
from pathlib import Path
from datetime import datetime
from parser import parse_mermaid, load_agent, AgentGraph, NodeMeta, EdgeMeta


def compile_system_prompt(agent_dir: str) -> str:
    """Compile a full system prompt from an agent directory."""
    agent = load_agent(agent_dir)
    graph = agent["graph"]
    config = agent.get("config", {}) or {}
    index_content = agent.get("index", "")

    sections = []

    # ── Section 1: Identity & Purpose ──
    sections.append(_compile_identity(config, index_content))

    # ── Section 2: Execution Graph Overview ──
    if graph:
        sections.append(_compile_graph_overview(graph, config))

    # ── Section 3: Node Instructions (topological order) ──
    if graph:
        sections.append(_compile_node_instructions(graph, agent["nodes"]))

    # ── Section 4: Tool Definitions ──
    tools_section = _compile_tools(agent["nodes"], config)
    if tools_section:
        sections.append(tools_section)

    # ── Section 5: Data Contracts ──
    if graph:
        sections.append(_compile_data_contracts(graph))

    # ── Section 6: Guardrails ──
    guardrails = _compile_guardrails(agent["nodes"])
    if guardrails:
        sections.append(guardrails)

    # ── Section 7: Error Handling ──
    sections.append(_compile_error_handling(graph, config))

    # ── Section 8: Sub-Agent References ──
    subagent_section = _compile_subagents(agent["nodes"])
    if subagent_section:
        sections.append(subagent_section)

    # ── Footer ──
    sections.append(_compile_footer(agent_dir))

    return "\n\n---\n\n".join(sections)


def _compile_identity(config: dict, index_content: str) -> str:
    name = config.get("name", "Unnamed Agent")
    version = config.get("version", "0.1.0")
    description = config.get("description", "")

    lines = [
        f"# {name} (v{version})",
        "",
        f"## Identity & Purpose",
        "",
    ]

    if description:
        lines.append(description)
        lines.append("")

    if index_content:
        lines.append(index_content)

    defaults = config.get("defaults", {})
    if defaults:
        lines.append("")
        lines.append("### Default Configuration")
        lines.append(f"- **Model**: {defaults.get('model', 'not specified')}")
        lines.append(f"- **Temperature**: {defaults.get('temperature', 'default')}")
        lines.append(f"- **Max Tokens**: {defaults.get('max_tokens', 'default')}")

    return "\n".join(lines)


def _compile_graph_overview(graph: AgentGraph, config: dict) -> str:
    lines = [
        "## Execution Flow",
        "",
        "You operate as a graph-based agent. Your reasoning follows this flow:",
        "",
    ]

    topo_order = graph.topological_sort()

    # Generate natural language walkthrough
    lines.append("### Step-by-Step Flow")
    lines.append("")

    for i, node_id in enumerate(topo_order, 1):
        node = graph.nodes.get(node_id)
        if not node:
            continue

        children = graph.get_children(node_id)
        node_desc = f"**Step {i} — {node.display_name}** (`{node_id}`)"
        node_desc += f" [type: {node.node_type}]"

        lines.append(f"{i}. {node_desc}")

        if children:
            for edge in children:
                target = graph.nodes.get(edge.target, NodeMeta(id=edge.target, display_name=edge.target))
                if edge.condition:
                    lines.append(f"   - If `{edge.condition}` → go to **{target.display_name}**")
                elif edge.on_error:
                    lines.append(f"   - On error → go to **{target.display_name}**")
                else:
                    lines.append(f"   - Then → **{target.display_name}**")

                if edge.pass_fields:
                    lines.append(f"     - Pass: `{edge.pass_fields}`")

        lines.append("")

    # Execution mode
    exec_config = config.get("execution", {})
    if exec_config:
        lines.append("### Execution Rules")
        mode = exec_config.get("mode", "sequential")
        lines.append(f"- **Mode**: {mode}")
        if exec_config.get("max_total_time"):
            lines.append(f"- **Max Total Time**: {exec_config['max_total_time']}")
        if exec_config.get("error_strategy"):
            lines.append(f"- **Error Strategy**: {exec_config['error_strategy']}")

    return "\n".join(lines)


def _compile_node_instructions(graph: AgentGraph, nodes: dict) -> str:
    lines = [
        "## Node Instructions",
        "",
        "Below are your detailed instructions for each step. Execute them in order",
        "as you traverse the graph. Each node has specific behavior you must follow.",
        "",
    ]

    topo_order = graph.topological_sort()

    for node_id in topo_order:
        node = graph.nodes.get(node_id)
        if not node:
            continue

        node_dir_name = node_id.replace("_", "-")
        node_data = nodes.get(node_dir_name, nodes.get(node_id, {}))

        lines.append(f"### 🔹 {node.display_name} (`{node_id}`)")
        lines.append(f"- **Type**: {node.node_type}")
        if node.model:
            lines.append(f"- **Model Override**: {node.model}")
        if node.retry > 1:
            lines.append(f"- **Retry**: up to {node.retry} times")
        if node.timeout:
            lines.append(f"- **Timeout**: {node.timeout}")
        lines.append("")

        # Include node instructions from index.md
        instructions = node_data.get("instructions", "")
        if instructions:
            lines.append(instructions)
        else:
            lines.append(f"*No specific instructions defined for `{node_id}`. Use the node type and graph context to determine behavior.*")

        # Include references
        refs = node_data.get("references", [])
        if refs:
            lines.append("")
            lines.append("**Reference Materials:**")
            for ref in refs:
                lines.append(f"<reference name=\"{ref['name']}\">")
                lines.append(ref["content"])
                lines.append("</reference>")

        lines.append("")

    return "\n".join(lines)


def _compile_tools(nodes: dict, config: dict) -> str:
    all_tools = []
    mcp_servers = config.get("mcp_servers", [])

    # Collect from config
    for server in mcp_servers:
        all_tools.append({
            "source": "agent-config",
            "type": "mcp_server",
            **server
        })

    # Collect from nodes
    for node_name, node_data in nodes.items():
        tools = node_data.get("tools")
        if tools:
            for tool in (tools if isinstance(tools, list) else [tools]):
                tool["source_node"] = node_name
                all_tools.append(tool)

    if not all_tools:
        return ""

    lines = [
        "## Available Tools",
        "",
    ]

    mcp = [t for t in all_tools if t.get("type") == "mcp_server"]
    if mcp:
        lines.append("### MCP Servers")
        for server in mcp:
            lines.append(f"- **{server.get('name', 'unnamed')}**: `{server.get('url', 'no url')}`")
            if server.get("source_node"):
                lines.append(f"  - Used by node: `{server['source_node']}`")
        lines.append("")

    functions = [t for t in all_tools if t.get("type") == "function"]
    if functions:
        lines.append("### Functions")
        for func in functions:
            lines.append(f"- **{func.get('name', 'unnamed')}**: {func.get('description', '')}")
        lines.append("")

    return "\n".join(lines)


def _compile_data_contracts(graph: AgentGraph) -> str:
    lines = [
        "## Data Contracts Between Nodes",
        "",
        "These define what data flows between nodes along each edge:",
        "",
    ]

    for edge in graph.edges:
        src = graph.nodes.get(edge.source, NodeMeta(id=edge.source, display_name=edge.source))
        tgt = graph.nodes.get(edge.target, NodeMeta(id=edge.target, display_name=edge.target))

        lines.append(f"**{src.display_name}** → **{tgt.display_name}**")
        if edge.condition:
            lines.append(f"  - Condition: `{edge.condition}`")
        if edge.pass_fields:
            lines.append(f"  - Data passed: `{edge.pass_fields}`")
        if edge.transform:
            lines.append(f"  - Transform: `{edge.transform}`")
        lines.append("")

    return "\n".join(lines)


def _compile_guardrails(nodes: dict) -> str:
    all_guardrails = []

    for node_name, node_data in nodes.items():
        gr = node_data.get("guardrails")
        if gr:
            all_guardrails.append((node_name, gr))

    if not all_guardrails:
        return ""

    lines = [
        "## Guardrails & Validation",
        "",
    ]

    for node_name, gr in all_guardrails:
        lines.append(f"### {node_name}")

        input_rules = gr.get("input", [])
        if input_rules:
            lines.append("**Input Validation:**")
            for rule in input_rules:
                lines.append(f"  - {rule}")

        output_rules = gr.get("output", [])
        if output_rules:
            lines.append("**Output Validation:**")
            for rule in output_rules:
                lines.append(f"  - {rule}")

        lines.append("")

    return "\n".join(lines)


def _compile_error_handling(graph: AgentGraph, config: dict) -> str:
    lines = [
        "## Error Handling",
        "",
    ]

    strategy = config.get("execution", {}).get("error_strategy", "log_and_continue")
    lines.append(f"**Default Strategy**: {strategy}")
    lines.append("")

    # Find error edges
    error_edges = [e for e in (graph.edges if graph else []) if e.on_error]
    if error_edges:
        lines.append("**Error Routes:**")
        for edge in error_edges:
            src = graph.nodes.get(edge.source, NodeMeta(id=edge.source, display_name=edge.source))
            tgt = graph.nodes.get(edge.target, NodeMeta(id=edge.target, display_name=edge.target))
            lines.append(f"- If `{src.display_name}` fails → route to `{tgt.display_name}`")
        lines.append("")

    # Find retry nodes
    retry_nodes = [n for n in (graph.nodes.values() if graph else []) if n.retry > 1]
    if retry_nodes:
        lines.append("**Retry-enabled Nodes:**")
        for node in retry_nodes:
            lines.append(f"- `{node.display_name}`: up to {node.retry} retries")
        lines.append("")

    lines.append("**General Rules:**")
    lines.append("- If a node fails and has no error route, apply the default strategy")
    lines.append("- Always log the error context for debugging")
    lines.append("- Never silently swallow errors — the user should know what happened")

    return "\n".join(lines)


def _compile_subagents(nodes: dict) -> str:
    subagents = [(name, data) for name, data in nodes.items() if "sub_agent" in data]

    if not subagents:
        return ""

    lines = [
        "## Sub-Agent References",
        "",
        "Some nodes are full sub-agents with their own graph and instructions.",
        "When executing these nodes, you enter the sub-agent context:",
        "",
    ]

    for name, data in subagents:
        sub = data["sub_agent"]
        sub_config = sub.get("config", {}) or {}
        lines.append(f"### Sub-Agent: {name}")
        lines.append(f"- **Name**: {sub_config.get('name', name)}")
        lines.append(f"- **Path**: `{data['path']}`")

        if sub.get("graph"):
            node_count = len(sub["graph"].nodes)
            lines.append(f"- **Complexity**: {node_count} nodes")

        lines.append(f"- **System Prompt**: See `{data['path']}/SYSTEM_PROMPT.md`")
        lines.append("")

    return "\n".join(lines)


def _compile_footer(agent_dir: str) -> str:
    return f"""## Meta

- **Agent Directory**: `{agent_dir}`
- **Generated At**: {datetime.now().isoformat()}
- **Generator**: Agent DSL Compiler v1.0

> ⚠️ This file is auto-generated. Do not edit manually.
> To update, modify the source files and re-run the compiler."""


def compile_and_write(agent_dir: str) -> str:
    """Compile and write the SYSTEM_PROMPT.md to the agent directory."""
    prompt = compile_system_prompt(agent_dir)
    output_path = Path(agent_dir) / "SYSTEM_PROMPT.md"
    output_path.write_text(prompt)
    print(f"✅ Compiled system prompt → {output_path}")
    print(f"   Size: {len(prompt)} chars, {len(prompt.split(chr(10)))} lines")

    # Also compile sub-agents recursively
    agent = load_agent(agent_dir)
    for node_name, node_data in agent.get("nodes", {}).items():
        if "sub_agent" in node_data:
            sub_path = node_data["path"]
            print(f"\n📦 Compiling sub-agent: {node_name}")
            compile_and_write(sub_path)

    return prompt


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        compile_and_write(sys.argv[1])
    else:
        print("Usage: python compiler.py <agent-directory>")
