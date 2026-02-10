import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import yaml from "js-yaml";

// ── State ──

class AgentState {
  constructor(agentPath) {
    this.agentPath = agentPath;
    this.currentNode = null;
    this.history = [];
    this.iterationCounts = {};
    this.sharedContext = {};
    this.nodeOutputs = {};
    this.status = "running";
    this.startTime = new Date().toISOString();
    this.config = null;
    this.nodeMaxIterations = {};

    // Load config
    const configPath = join(agentPath, "agent-config.yaml");
    if (existsSync(configPath)) {
      this.config = yaml.load(readFileSync(configPath, "utf-8"));
    }

    // Extract @max_iterations from mermaid
    const mermaidPath = join(agentPath, "agent-mermaid.md");
    if (existsSync(mermaidPath)) {
      const content = readFileSync(mermaidPath, "utf-8");
      const re = /(\w+)[\s\S]*?@max_iterations:\s*(\d+)/g;
      let m;
      while ((m = re.exec(content)) !== null) {
        this.nodeMaxIterations[m[1]] = parseInt(m[2]);
      }
    }
  }
}

let state = null;

// ── Server ──

const server = new McpServer({
  name: "agent-runtime",
  version: "1.0.0",
});

// ── agent_init ──

server.tool(
  "agent_init",
  "Initialize the agent runtime with an agent directory. Call this first.",
  { agent_path: z.string().describe("Absolute path to the agent directory") },
  async ({ agent_path }) => {
    const p = resolve(agent_path);
    if (!existsSync(p)) {
      return { content: [{ type: "text", text: JSON.stringify({ error: `Not found: ${p}` }) }] };
    }
    state = new AgentState(p);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "initialized",
          agent_path: p,
          config_name: state.config?.name || null,
          config_version: state.config?.version || null,
          max_iteration_nodes: state.nodeMaxIterations,
        }, null, 2),
      }],
    };
  }
);

// ── node_enter ──

server.tool(
  "node_enter",
  "Declare entering a graph node. Validates iteration limits. Returns node instructions if found.",
  {
    node_id: z.string().describe("Node ID to enter"),
    input_data: z.record(z.string(), z.any()).optional().describe("Data from @pass edge"),
  },
  async ({ node_id, input_data }) => {
    if (!state) return err("Call agent_init first.");

    const count = state.iterationCounts[node_id] || 0;
    const max = state.nodeMaxIterations[node_id] || null;

    if (max && count >= max) {
      state.history.push({ action: "iteration_limit", node: node_id, ts: ts() });
      return ok({
        status: "iteration_limit_reached",
        node_id,
        iterations: count,
        max_iterations: max,
        message: `Node '${node_id}' hit max iterations (${max}). Take the exit path.`,
      });
    }

    state.currentNode = node_id;
    state.iterationCounts[node_id] = count + 1;
    if (input_data) state.sharedContext[`${node_id}_input`] = input_data;
    state.history.push({ action: "enter", node: node_id, iteration: count + 1, ts: ts() });

    // Try to load node instructions
    let instructions = null;
    for (const name of [node_id, node_id.replace(/_/g, "-")]) {
      const p = join(state.agentPath, "nodes", name, "index.md");
      if (existsSync(p)) { instructions = readFileSync(p, "utf-8"); break; }
    }

    return ok({
      status: "entered",
      node_id,
      iteration: count + 1,
      max_iterations: max,
      input_data: input_data || {},
      has_instructions: !!instructions,
      instructions_preview: instructions ? instructions.substring(0, 300) + "..." : null,
    });
  }
);

// ── node_complete ──

server.tool(
  "node_complete",
  "Declare completing a node with its output.",
  {
    node_id: z.string().describe("Completed node ID"),
    output_data: z.record(z.string(), z.any()).describe("Node output data"),
  },
  async ({ node_id, output_data }) => {
    if (!state) return err("Call agent_init first.");
    state.nodeOutputs[node_id] = output_data;
    state.sharedContext[`${node_id}_output`] = output_data;
    state.history.push({ action: "complete", node: node_id, keys: Object.keys(output_data), ts: ts() });
    return ok({ status: "completed", node_id, output_keys: Object.keys(output_data) });
  }
);

// ── route_decision ──

server.tool(
  "route_decision",
  "Record a routing decision — which node to go to next and why.",
  {
    from_node: z.string(),
    to_node: z.string(),
    condition: z.string().optional().describe("@cond expression that was met"),
    rationale: z.string().describe("Why this route was chosen"),
    data_to_pass: z.record(z.string(), z.any()).optional().describe("@pass fields"),
  },
  async ({ from_node, to_node, condition, rationale, data_to_pass }) => {
    if (!state) return err("Call agent_init first.");
    if (data_to_pass) state.sharedContext[`${to_node}_input`] = data_to_pass;
    state.history.push({ action: "route", from: from_node, to: to_node, condition, rationale, ts: ts() });
    return ok({
      status: "routed",
      from: from_node,
      to: to_node,
      condition: condition || "unconditional",
      next_step: `Call node_enter("${to_node}") to proceed.`,
    });
  }
);

// ── get_execution_state ──

server.tool(
  "get_execution_state",
  "Get current state: current node, nodes visited, iteration counts, context keys.",
  {},
  async () => {
    if (!state) return err("Call agent_init first.");
    return ok({
      status: state.status,
      current_node: state.currentNode,
      nodes_visited: [...new Set(state.history.filter(h => h.action === "enter").map(h => h.node))],
      iteration_counts: state.iterationCounts,
      context_keys: Object.keys(state.sharedContext),
      event_count: state.history.length,
      started_at: state.startTime,
    });
  }
);

// ── set_shared_context ──

server.tool(
  "set_shared_context",
  "Store a value in shared context accessible across all nodes.",
  {
    key: z.string(),
    value: z.any(),
  },
  async ({ key, value }) => {
    if (!state) return err("Call agent_init first.");
    state.sharedContext[key] = value;
    return ok({ stored: key });
  }
);

// ── get_shared_context ──

server.tool(
  "get_shared_context",
  "Retrieve a value from shared context.",
  { key: z.string() },
  async ({ key }) => {
    if (!state) return err("Call agent_init first.");
    return ok({ key, value: state.sharedContext[key] ?? null, found: key in state.sharedContext });
  }
);

// ── request_human_input ──

server.tool(
  "request_human_input",
  "Pause execution and request input from the user. Use at human_input nodes.",
  {
    prompt: z.string().describe("What to ask the human"),
    options: z.array(z.string()).optional().describe("Predefined options"),
  },
  async ({ prompt, options }) => {
    if (!state) return err("Call agent_init first.");
    state.status = "paused";
    state.history.push({ action: "human_input_requested", node: state.currentNode, prompt, ts: ts() });
    return ok({
      status: "paused_for_human",
      prompt,
      options: options || [],
      message: "Present this to the user. Resume when they respond.",
    });
  }
);

// ── spawn_subagent ──

server.tool(
  "spawn_subagent",
  "Load a sub-agent's system prompt for delegation. Returns the prompt to execute inline or via API.",
  {
    agent_path: z.string().describe("Path to sub-agent directory"),
    input_data: z.record(z.string(), z.any()).describe("Input data for the sub-agent"),
  },
  async ({ agent_path, input_data }) => {
    if (!state) return err("Call agent_init first.");
    const p = resolve(agent_path);
    const spPath = join(p, "SYSTEM_PROMPT.md");
    let prompt = null;
    if (existsSync(spPath)) prompt = readFileSync(spPath, "utf-8");

    state.history.push({ action: "subagent_spawn", node: state.currentNode, path: p, ts: ts() });

    return ok({
      status: prompt ? "ready" : "no_system_prompt",
      agent_path: p,
      has_system_prompt: !!prompt,
      system_prompt_chars: prompt?.length || 0,
      input_data,
      message: prompt
        ? "Sub-agent loaded. Execute its instructions inline with the given input."
        : "No SYSTEM_PROMPT.md found. Compile the sub-agent first.",
    });
  }
);

// ── complete_execution ──

server.tool(
  "complete_execution",
  "Mark agent execution as complete. Call at terminal nodes.",
  {
    final_output: z.record(z.string(), z.any()).describe("Final agent output"),
    status: z.enum(["success", "partial", "error"]),
    summary: z.string().optional(),
  },
  async ({ final_output, status, summary }) => {
    if (!state) return err("Call agent_init first.");
    state.status = "completed";
    state.history.push({ action: "complete_execution", status, ts: ts() });

    const enters = state.history.filter(h => h.action === "enter");
    return ok({
      status: "completed",
      completion_status: status,
      summary: summary || null,
      final_output,
      stats: {
        events: state.history.length,
        nodes_visited: enters.length,
        unique_nodes: [...new Set(enters.map(h => h.node))].length,
        routes: state.history.filter(h => h.action === "route").length,
        iterations: state.iterationCounts,
      },
    });
  }
);

// ── get_execution_trace ──

server.tool(
  "get_execution_trace",
  "Get full execution trace — every event in order.",
  {},
  async () => {
    if (!state) return err("Call agent_init first.");
    return ok({ trace: state.history, count: state.history.length });
  }
);

// ── Helpers ──

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function err(msg) {
  return { content: [{ type: "text", text: JSON.stringify({ error: msg }) }], isError: true };
}
function ts() {
  return new Date().toISOString();
}

// ── Start ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("agent-runtime MCP server running");
}

main().catch(console.error);
