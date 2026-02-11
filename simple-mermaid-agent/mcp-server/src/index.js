import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Agent is initialized when MCP session starts (AGENT_PATH env). No separate init tool.
let agentPath = null;
const envAgentPath = process.env.AGENT_PATH && resolve(process.env.AGENT_PATH);
if (envAgentPath && existsSync(envAgentPath) && existsSync(join(envAgentPath, "agent-mermaid.md"))) {
  agentPath = envAgentPath;
  console.error(`[simple-mermaid-agent] agent loaded: ${agentPath}`);
}

const mcpServer = new McpServer({ name: "simple-mermaid-agent", version: "1.0.0" });

function ok(d) {
  return { content: [{ type: "text", text: typeof d === "string" ? d : JSON.stringify(d, null, 2) }] };
}
function err(m) {
  return { content: [{ type: "text", text: JSON.stringify({ error: m }) }], isError: true };
}

// Single tool: enter a node and get that node's instructions (index.md) for guidelines, guardrails, behavior.
mcpServer.tool(
  "node_enter",
  "Enter a graph node. Returns the node's instructions from nodes/{node_id}/index.md (guidelines, guardrails, behavior). Call this when executing a node in the agent graph.",
  {
    node_id: z.string().describe("Node ID as in agent-mermaid.md"),
    input_data: z.record(z.string(), z.any()).optional().describe("Data passed into this node from the graph"),
  },
  async ({ node_id, input_data }) => {
    if (!agentPath) {
      return err("No agent loaded. Set AGENT_PATH to the agent directory when starting the MCP server (e.g. in .mcp.json).");
    }
    let instructions = null;
    for (const n of [node_id, node_id.replace(/_/g, "-")]) {
      const ip = join(agentPath, "nodes", n, "index.md");
      if (existsSync(ip)) {
        instructions = readFileSync(ip, "utf-8");
        break;
      }
    }
    const result = {
      node_id,
      has_instructions: !!instructions,
      instructions: instructions ?? "No index.md found for this node. Define behavior in nodes/" + node_id + "/index.md",
      input_data: input_data ?? {},
    };
    return ok(result);
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error("[simple-mermaid-agent] MCP ready" + (agentPath ? ` (agent: ${agentPath})` : " (no AGENT_PATH)"));
}

main().catch(console.error);
