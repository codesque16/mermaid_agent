import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════════════
// Session-Persistent State
// ═══════════════════════════════════════════════════════

class AgentState {
  constructor(agentPath, sessionId) {
    this.agentPath = agentPath;
    this.sessionId = sessionId;
    this.currentNode = null;
    this.history = [];
    this.iterationCounts = {};
    this.sharedContext = {};
    this.nodeOutputs = {};
    this.status = "initialized";
    this.startTime = new Date().toISOString();
    this.config = null;
    this.nodeMaxIterations = {};
    this.mermaidSource = null;
    this.agentName = "agent";

    // Load agent config
    const configPath = join(agentPath, "agent-config.yaml");
    if (existsSync(configPath)) {
      this.config = yaml.load(readFileSync(configPath, "utf-8"));
      this.agentName = this.config?.name || "agent";
    }

    // Load mermaid — the source of truth
    const mermaidPath = join(agentPath, "agent-mermaid.md");
    if (existsSync(mermaidPath)) {
      this.mermaidSource = readFileSync(mermaidPath, "utf-8");
      const re = /(\w+)[\s\S]*?@max_iterations:\s*(\d+)/g;
      let m;
      while ((m = re.exec(this.mermaidSource)) !== null) {
        this.nodeMaxIterations[m[1]] = parseInt(m[2]);
      }
    }

    // Session persistence directory
    this.sessionsDir = join(agentPath, ".agent-sessions");
    mkdirSync(this.sessionsDir, { recursive: true });
    this.stateFile = join(this.sessionsDir, `${sessionId}.json`);
    this.traceFile = join(this.sessionsDir, `${sessionId}.trace.jsonl`);

    // Restore if session exists
    if (existsSync(this.stateFile)) {
      try {
        const saved = JSON.parse(readFileSync(this.stateFile, "utf-8"));
        this.currentNode = saved.currentNode || null;
        this.history = saved.history || [];
        this.iterationCounts = saved.iterationCounts || {};
        this.sharedContext = saved.sharedContext || {};
        this.nodeOutputs = saved.nodeOutputs || {};
        this.status = saved.status || "initialized";
        this.startTime = saved.startTime || this.startTime;
        console.error(`[session] Restored: ${this.history.length} events, node=${this.currentNode}`);
      } catch (e) {
        console.error(`[session] Restore failed: ${e.message}`);
      }
    }
  }

  persist() {
    try {
      writeFileSync(this.stateFile, JSON.stringify({
        sessionId: this.sessionId, agentPath: this.agentPath,
        agentName: this.agentName, currentNode: this.currentNode,
        history: this.history, iterationCounts: this.iterationCounts,
        sharedContext: this.sharedContext, nodeOutputs: this.nodeOutputs,
        status: this.status, startTime: this.startTime,
        savedAt: new Date().toISOString(),
      }, null, 2));
    } catch (e) { console.error(`[persist] ${e.message}`); }
  }

  record(event) {
    event.ts = new Date().toISOString();
    this.history.push(event);
    // Append to JSONL trace file
    try { writeFileSync(this.traceFile, JSON.stringify(event) + "\n", { flag: "a" }); }
    catch (e) { /* ignore */ }
    this.persist();
    broadcastTrace(event);
    broadcastState(this);
  }

  getVisitedNodes() {
    return [...new Set(this.history.filter(h => h.action === "enter").map(h => h.node))];
  }

  getContextSample() {
    const out = {};
    for (const [k, v] of Object.entries(this.sharedContext)) {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      out[k] = s.length > 80 ? s.substring(0, 77) + "..." : v;
    }
    return out;
  }
}


// ═══════════════════════════════════════════════════════
// Live Visualizer (HTTP + SSE)
// ═══════════════════════════════════════════════════════

let sseClients = [];
let vizServer = null;
let vizPort = null;

function broadcastTrace(event) {
  const msg = `event: trace\ndata: ${JSON.stringify(event)}\n\n`;
  sseClients.forEach(r => r.write(msg));
}

function broadcastState(s) {
  const msg = `event: state\ndata: ${JSON.stringify({
    status: s.status, current_node: s.currentNode,
    visited: s.getVisitedNodes(),
    context_keys: Object.keys(s.sharedContext),
    context_sample: s.getContextSample(),
  })}\n\n`;
  sseClients.forEach(r => r.write(msg));
}

function startVisualizer(state) {
  if (vizServer) return vizPort;

  // Use mermaid source as-is (Mermaid v11 renders @key: value and multi-line nodes; no transform)
  let mermaid = "";
  if (state.mermaidSource) {
    const match = state.mermaidSource.match(/```mermaid\s*([\s\S]*?)```/);
    mermaid = match ? match[1].trim() : state.mermaidSource;
  }
  mermaid = mermaid.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Debug: write mermaid source to a file (visible when MCP runs under Claude; copy-paste to mermaid.live to test)
  const debugPath = join(__dirname, "..", "..", "visualizer-mermaid-debug.txt");
  try {
    writeFileSync(debugPath, mermaid, "utf-8");
  } catch (e) {
    /* ignore */
  }
  console.log("[visualizer] Mermaid source being rendered:\n---\n" + mermaid + "\n---");

  // Escape for HTML so < > & in labels (e.g. "value < 500") don't break the page
  const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  mermaid = escapeHtml(mermaid);

  // Load + template the HTML (use regex so placeholder is always replaced)
  let html = readFileSync(join(__dirname, "visualizer.html"), "utf-8");
  const agentName = (state.agentName && String(state.agentName).trim() && !String(state.agentName).includes("{{")) ? state.agentName : "Agent";
  html = html.replace(/\{\{\s*AGENT_NAME\s*\}\}/g, agentName);
  html = html.replace("{{SESSION_ID}}", state.sessionId.substring(0, 8));
  html = html.replace("{{MERMAID_SOURCE}}", mermaid);

  vizServer = createServer((req, res) => {
    if (req.url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      sseClients.push(res);
      // Send full state on connect
      const full = `event: full_state\ndata: ${JSON.stringify({
        status: state.status, current_node: state.currentNode,
        visited: state.getVisitedNodes(), history: state.history,
        context_keys: Object.keys(state.sharedContext),
        context_sample: state.getContextSample(),
      })}\n\n`;
      res.write(full);
      req.on("close", () => { sseClients = sseClients.filter(c => c !== res); });
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    }
  });

  vizServer.listen(0, "127.0.0.1", () => {
    vizPort = vizServer.address().port;
    const url = `http://127.0.0.1:${vizPort}`;
    console.error(`[visualizer] ${url}`);

    const width = 420;
    const height = 900;
    const args = [`--app=${url}`, `--window-size=${width},${height}`];

    // Spawn Chrome directly so we get a real app window (no tab in existing window)
    const chromePaths = {
      darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      linux: "google-chrome",
    };
    const chromePath = chromePaths[process.platform];
    if (chromePath) {
      const proc = spawn(chromePath, args, { detached: true, stdio: "ignore" });
      proc.on("error", (e) => {
        console.error(`[visualizer] Chrome spawn failed: ${e.message}`);
        import("open").then(({ default: open }) => open(url).catch(() => console.error(`[visualizer] Open manually: ${url}`)));
      });
      proc.unref();
      if (proc.pid) console.error(`[visualizer] Opened Chrome app window`);
    } else {
      import("open").then(({ default: open }) => open(url).catch(() => console.error(`[visualizer] Open manually: ${url}`)));
    }
  });

  return vizPort;
}


// ═══════════════════════════════════════════════════════
// MCP Server + Tools
// ═══════════════════════════════════════════════════════

const mcpServer = new McpServer({ name: "agent-runtime", version: "2.0.0" });
const SESSION_ID = process.env.AGENT_SESSION_ID || randomUUID();
let state = null;

console.error(`[agent-runtime] session=${SESSION_ID}`);

// Auto-init and launch visualizer when AGENT_PATH is set (e.g. by .mcp.json) so the window opens on session start
const envAgentPath = process.env.AGENT_PATH && resolve(process.env.AGENT_PATH);
if (envAgentPath && existsSync(envAgentPath) && existsSync(join(envAgentPath, "agent-mermaid.md"))) {
  state = new AgentState(envAgentPath, SESSION_ID);
  state.record({ action: "init", agent: state.agentName, path: envAgentPath });
  startVisualizer(state);
}

function ok(d) { return { content: [{ type: "text", text: JSON.stringify(d, null, 2) }] }; }
function err(m) { return { content: [{ type: "text", text: JSON.stringify({ error: m }) }], isError: true }; }

// mcpServer.tool("agent_init",
//   "Initialize runtime. Loads graph from agent-mermaid.md (source of truth), restores session, spawns visualizer.",
//   { agent_path: z.string().describe("Absolute path to the agent directory") },
//   async ({ agent_path }) => {
//     const p = resolve(agent_path);
//     if (!existsSync(p)) return err(`Not found: ${p}`);
//     if (!existsSync(join(p, "agent-mermaid.md")))
//       return err(`No agent-mermaid.md in ${p}. This is the required source of truth.`);

//     if (state && state.agentPath === p) {
//       return ok({
//         status: "initialized", session_id: SESSION_ID,
//         agent_path: p, agent_name: state.agentName,
//         has_mermaid: true,
//         max_iteration_nodes: state.nodeMaxIterations,
//         restored_events: state.history.length > 1 ? state.history.length - 1 : 0,
//         visualizer: vizPort ? `http://127.0.0.1:${vizPort}` : "starting...",
//         session_file: state.stateFile,
//       });
//     }

//     state = new AgentState(p, SESSION_ID);
//     state.record({ action: "init", agent: state.agentName, path: p });
//     startVisualizer(state);

//     return ok({
//       status: "initialized", session_id: SESSION_ID,
//       agent_path: p, agent_name: state.agentName,
//       has_mermaid: true,
//       max_iteration_nodes: state.nodeMaxIterations,
//       restored_events: state.history.length > 1 ? state.history.length - 1 : 0,
//       visualizer: vizPort ? `http://127.0.0.1:${vizPort}` : "starting...",
//       session_file: state.stateFile,
//     });
//   }
// );

mcpServer.tool("node_enter",
  "Enter a graph node (from agent-mermaid.md). Validates iteration limits. Loads instructions from nodes/{id}/index.md.",
  {
    node_id: z.string().describe("Node ID as defined in agent-mermaid.md"),
    reason: z.string().optional().describe("Why entering this node (e.g. routing rationale, @cond satisfied, or decision basis)"),
    input_data: z.record(z.string(), z.any()).optional().describe("Data from @pass on incoming edge"),
  },
  async ({ node_id, reason, input_data }) => {
    if (!state) return err("Call agent_init first.");
    const count = state.iterationCounts[node_id] || 0;
    const max = state.nodeMaxIterations[node_id] || null;
    if (max && count >= max) {
      state.record({ action: "iteration_limit", node: node_id, count, max });
      return ok({ status: "iteration_limit_reached", node_id, iterations: count, max_iterations: max,
        message: `'${node_id}' hit max iterations (${max}). Take the exit path.` });
    }
    state.currentNode = node_id;
    state.iterationCounts[node_id] = count + 1;
    if (input_data) state.sharedContext[`${node_id}_input`] = input_data;

    let instructions = null;
    for (const n of [node_id, node_id.replace(/_/g, "-")]) {
      const ip = join(state.agentPath, "nodes", n, "index.md");
      if (existsSync(ip)) { instructions = readFileSync(ip, "utf-8"); break; }
    }

    state.record({
      action: "enter",
      node: node_id,
      iteration: count + 1,
      reason: reason || null,
      input_data: input_data || {},
      has_instructions: !!instructions,
      instructions: instructions || null,
    });

    return ok({ status: "entered", node_id, iteration: count + 1, max_iterations: max,
      reason: reason || null,
      input_data: input_data || {}, has_instructions: !!instructions,
      instructions: instructions || null });
  }
);

// mcpServer.tool("node_complete",
//   "Complete a node with output data.",
//   { node_id: z.string(), output_data: z.record(z.string(), z.any()) },
//   async ({ node_id, output_data }) => {
//     if (!state) return err("Call agent_init first.");
//     state.nodeOutputs[node_id] = output_data;
//     state.sharedContext[`${node_id}_output`] = output_data;
//     state.record({
//       action: "complete",
//       node: node_id,
//       keys: Object.keys(output_data),
//       output_data,
//     });
//     return ok({ status: "completed", node_id, output_keys: Object.keys(output_data) });
//   }
// );

// mcpServer.tool("route_decision",
//   "Record routing between nodes. Use @cond from agent-mermaid.md edges.",
//   {
//     from_node: z.string(), to_node: z.string(),
//     condition: z.string().optional().describe("@cond that was satisfied"),
//     rationale: z.string().describe("Why this route"),
//     data_to_pass: z.record(z.string(), z.any()).optional().describe("@pass fields"),
//   },
//   async ({ from_node, to_node, condition, rationale, data_to_pass }) => {
//     if (!state) return err("Call agent_init first.");
//     if (data_to_pass) state.sharedContext[`${to_node}_input`] = data_to_pass;
//     state.record({
//       action: "route",
//       from: from_node,
//       to: to_node,
//       condition,
//       rationale,
//       data_passed: data_to_pass || null,
//     });
//     return ok({ status: "routed", from: from_node, to: to_node, condition: condition || "unconditional" });
//   }
// );

// mcpServer.tool("get_execution_state", "Current execution state.", {},
//   async () => {
//     if (!state) return err("Call agent_init first.");
//     return ok({ session_id: state.sessionId, status: state.status,
//       current_node: state.currentNode, visited: state.getVisitedNodes(),
//       iteration_counts: state.iterationCounts,
//       context_keys: Object.keys(state.sharedContext),
//       events: state.history.length, started_at: state.startTime,
//       visualizer: vizPort ? `http://127.0.0.1:${vizPort}` : null });
//   }
// );

// mcpServer.tool("set_shared_context", "Store in shared context (persisted to session file).",
//   { key: z.string(), value: z.any() },
//   async ({ key, value }) => {
//     if (!state) return err("Call agent_init first.");
//     state.sharedContext[key] = value;
//     state.record({
//       action: "shared_context_set",
//       key,
//       value,
//     });
//     return ok({ stored: key });
//   }
// );

// mcpServer.tool("get_shared_context", "Retrieve from shared context.",
//   { key: z.string() },
//   async ({ key }) => {
//     if (!state) return err("Call agent_init first.");
//     const found = key in state.sharedContext;
//     const value = state.sharedContext[key] ?? null;
//     state.record({
//       action: "shared_context_get",
//       key,
//       found,
//       value,
//     });
//     return ok({ key, value, found });
//   }
// );

// mcpServer.tool("request_human_input", "Pause for user input at human_input nodes.",
//   { prompt: z.string(), options: z.array(z.string()).optional() },
//   async ({ prompt, options }) => {
//     if (!state) return err("Call agent_init first.");
//     state.status = "paused";
//     state.record({ action: "human_input_requested", node: state.currentNode, prompt });
//     return ok({ status: "paused_for_human", prompt, options: options || [] });
//   }
// );

// mcpServer.tool("spawn_subagent", "Load sub-agent from nested agent-mermaid.md.",
//   { agent_path: z.string(), input_data: z.record(z.string(), z.any()) },
//   async ({ agent_path, input_data }) => {
//     if (!state) return err("Call agent_init first.");
//     const p = resolve(agent_path);
//     const hasSP = existsSync(join(p, "SYSTEM_PROMPT.md"));
//     const hasMermaid = existsSync(join(p, "agent-mermaid.md"));
//     state.record({ action: "subagent_spawn", node: state.currentNode, path: p });
//     return ok({ status: hasSP ? "ready" : "needs_compile", agent_path: p,
//       has_mermaid: hasMermaid, has_system_prompt: hasSP, input_data });
//   }
// );

// mcpServer.tool("complete_execution", "Mark agent complete at terminal node.",
//   { final_output: z.record(z.string(), z.any()),
//     status: z.enum(["success", "partial", "error"]),
//     summary: z.string().optional() },
//   async ({ final_output, status: cs, summary }) => {
//     if (!state) return err("Call agent_init first.");
//     state.status = "completed";
//     state.record({ action: "complete_execution", status: cs, summary });
//     const enters = state.history.filter(h => h.action === "enter");
//     return ok({ status: "completed", completion_status: cs, summary, final_output,
//       stats: { session_id: state.sessionId, events: state.history.length,
//         nodes_visited: enters.length,
//         unique_nodes: [...new Set(enters.map(h => h.node))].length,
//         routes: state.history.filter(h => h.action === "route").length,
//         iterations: state.iterationCounts },
//       files: { state: state.stateFile, trace: state.traceFile } });
//   }
// );

// mcpServer.tool("get_execution_trace", "Full execution trace.", {},
//   async () => {
//     if (!state) return err("Call agent_init first.");
//     return ok({ trace: state.history, count: state.history.length, file: state.traceFile });
//   }
// );


// ═══════════════════════════════════════════════════════
// Start
// ═══════════════════════════════════════════════════════

async function main() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error(`[agent-runtime] MCP ready (session: ${SESSION_ID})`);
}

main().catch(console.error);
