import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { randomUUID } from "crypto";
import { spawn } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════════════
// Agent state (for visualizer: current node, visited, trace)
// ═══════════════════════════════════════════════════════

let agentPath = null;
let vizState = null; // { sessionId, agentName, mermaidSource, currentNode, visited, history, status }
let sseClients = [];
let vizServer = null;
let vizPort = null;

function getVisited() {
  if (!vizState) return [];
  return [...new Set(vizState.history.filter((e) => e.action === "enter").map((e) => e.node))];
}

function broadcastState() {
  if (!vizState || sseClients.length === 0) return;
  const msg =
    `event: state\ndata: ${JSON.stringify({
      status: vizState.status,
      current_node: vizState.currentNode,
      visited: getVisited(),
      context_keys: [],
      context_sample: {},
    })}\n\n`;
  sseClients.forEach((r) => r.write(msg));
}

function broadcastTrace(event) {
  const msg = `event: trace\ndata: ${JSON.stringify(event)}\n\n`;
  sseClients.forEach((r) => r.write(msg));
}

function startVisualizer() {
  if (!agentPath || vizServer) return vizPort;

  const mermaidPath = join(agentPath, "agent-mermaid.md");
  if (!existsSync(mermaidPath)) return null;

  let mermaidSource = readFileSync(mermaidPath, "utf-8");
  const match = mermaidSource.match(/```mermaid\s*([\s\S]*?)```/);
  const mermaid = match ? match[1].trim() : mermaidSource;
  mermaidSource = mermaid.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const agentName =
    agentPath
      .split(/[/\\]/)
      .filter(Boolean)
      .pop() || "Agent";
  const sessionId = randomUUID();

  vizState = {
    sessionId: sessionId.substring(0, 8),
    agentName,
    mermaidSource: mermaid,
    currentNode: null,
    visited: [],
    history: [],
    status: "initialized",
  };

  const escapeHtml = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeMermaid = escapeHtml(mermaid);

  let html = readFileSync(join(__dirname, "visualizer.html"), "utf-8");
  html = html.replace(/\{\{\s*AGENT_NAME\s*\}\}/g, agentName);
  html = html.replace("{{SESSION_ID}}", vizState.sessionId);
  html = html.replace("{{MERMAID_SOURCE}}", safeMermaid);

  vizState.history.push({
    ts: new Date().toISOString(),
    action: "init",
    agent: agentName,
    path: agentPath,
  });

  vizServer = createServer((req, res) => {
    if (req.url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      sseClients.push(res);
      const full = `event: full_state\ndata: ${JSON.stringify({
        status: vizState.status,
        current_node: vizState.currentNode,
        visited: getVisited(),
        history: vizState.history,
        context_keys: [],
        context_sample: {},
      })}\n\n`;
      res.write(full);
      req.on("close", () => {
        sseClients = sseClients.filter((c) => c !== res);
      });
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    }
  });

  vizServer.listen(0, "127.0.0.1", () => {
    vizPort = vizServer.address().port;
    const url = `http://127.0.0.1:${vizPort}`;
    console.error(`[simple-mermaid-agent] visualizer: ${url}`);

    const chromePaths = {
      darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      linux: "google-chrome",
    };
    const chromePath = chromePaths[process.platform];
    if (chromePath) {
      const proc = spawn(chromePath, [`--app=${url}`, `--window-size=420,900`], {
        detached: true,
        stdio: "ignore",
      });
      proc.on("error", () => {
        import("open").then(({ default: open }) =>
          open(url).catch(() => console.error(`[simple-mermaid-agent] Open manually: ${url}`))
        );
      });
      proc.unref();
    } else {
      import("open").then(({ default: open }) =>
        open(url).catch(() => console.error(`[simple-mermaid-agent] Open manually: ${url}`))
      );
    }
  });

  return vizPort;
}

// Agent is initialized when MCP session starts (AGENT_PATH env). No separate init tool.
const envAgentPath = process.env.AGENT_PATH && resolve(process.env.AGENT_PATH);
if (
  envAgentPath &&
  existsSync(envAgentPath) &&
  existsSync(join(envAgentPath, "agent-mermaid.md"))
) {
  agentPath = envAgentPath;
  console.error(`[simple-mermaid-agent] agent loaded: ${agentPath}`);
  startVisualizer();
}

const mcpServer = new McpServer({ name: "simple-mermaid-agent", version: "1.0.0" });

function ok(d) {
  return {
    content: [{ type: "text", text: typeof d === "string" ? d : JSON.stringify(d, null, 2) }],
  };
}
function err(m) {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: m }) }],
    isError: true,
  };
}

// Single tool: enter a node and get that node's instructions (index.md) for guidelines, guardrails, behavior.
mcpServer.tool(
  "node_enter",
  "Enter a graph node. Returns the node's instructions from nodes/{node_id}/index.md (guidelines, guardrails, behavior). Call this when executing a node in the agent graph.",
  {
    node_id: z.string().describe("Node ID as in agent-mermaid.md"),
    input_data: z
      .record(z.string(), z.any())
      .optional()
      .describe("Data passed into this node from the graph"),
  },
  async ({ node_id, input_data }) => {
    if (!agentPath) {
      return err(
        "No agent loaded. Set AGENT_PATH to the agent directory when starting the MCP server (e.g. in .mcp.json)."
      );
    }
    let instructions = null;
    for (const n of [node_id, node_id.replace(/_/g, "-")]) {
      const ip = join(agentPath, "nodes", n, "index.md");
      if (existsSync(ip)) {
        instructions = readFileSync(ip, "utf-8");
        break;
      }
    }

    if (vizState) {
      vizState.currentNode = node_id;
      vizState.status = "running";
      const iteration =
        1 +
        vizState.history.filter((e) => e.action === "enter" && e.node === node_id).length;
      const event = {
        ts: new Date().toISOString(),
        action: "enter",
        node: node_id,
        iteration,
        input_data: input_data ?? {},
        has_instructions: !!instructions,
      };
      vizState.history.push(event);
      broadcastTrace(event);
      broadcastState();
    }

    const result = {
      node_id,
      has_instructions: !!instructions,
      instructions:
        instructions ??
        "No index.md found for this node. Define behavior in nodes/" + node_id + "/index.md",
      input_data: input_data ?? {},
    };
    return ok(result);
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error(
    "[simple-mermaid-agent] MCP ready" +
      (agentPath ? ` (agent: ${agentPath}` + (vizPort ? `, visualizer: http://127.0.0.1:${vizPort}` : "") + ")" : " (no AGENT_PATH)")
  );
}

main().catch(console.error);
