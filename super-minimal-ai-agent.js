// super-minimal-ai-agent.js
// A tiny, turn-based AI Agent runner for OpenAI + optional MCP tools + custom JS tools.
// ESM-compatible, Node 18+ (fetch available).

/**
 * Agent constructor options
 * @typedef {Object} AgentOptions
 * @property {string} system - System prompt to set role/behavior.
 * @property {string} model - OpenAI model name (e.g., "gpt-4.1", "gpt-4o", etc.).
 * @property {string} apiKey - OpenAI API key.
 * @property {string} [baseURL] - Custom API base (optional; defaults to https://api.openai.com/v1).
 * @property {number} [maxTurns=8] - Guardrail: maximum reasoning/tool turns.
 * @property {number} [maxToolCallsPerTurn=4] - Guardrail: maximum tool calls per turn.
 * @property {number} [temperature=0.2] - Sampling temperature.
 * @property {Array<CustomTool>} [tools] - Custom JS tools available to the agent.
 * @property {Array<MCPServerConfig>} [mcpServers] - Optional MCP servers to connect and expose their tools.
 * @property {(text:string)=>void} [onToken] - Optional streaming hook (placeholder in this version).
 * @property {boolean} [verbose=false] - Enable verbose debug logging to console.
 */

/**
 * @typedef {Object} CustomTool
 * @property {string} name
 * @property {string} description
 * @property {Object} parameters - JSON Schema for tool arguments
 * @property {(args:any, context: ToolContext)=>Promise<any>|any} handler
 */

/**
 * @typedef {Object} MCPServerConfig
 * @property {string} name
 * @property {string} url - ws(s):// URL for the MCP server transport
 * @property {Object} [headers] - optional headers for auth
 */

/**
 * @typedef {Object} ToolContext
 * @property {(msg:string)=>void} log - lightweight logger
 */

export class Agent {
  constructor (opts) {
    this.system = opts.system || "";
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.baseURL = (opts.baseURL || "https://api.openai.com/v1").replace(/\/$/, "");
    this.maxTurns = opts.maxTurns ?? 8;
    this.maxToolCallsPerTurn = opts.maxToolCallsPerTurn ?? 4;
    this.temperature = opts.temperature ?? 0.2;
    this.customTools = Array.isArray(opts.tools) ? opts.tools : [];
    this.mcpServers = Array.isArray(opts.mcpServers) ? opts.mcpServers : [];
    this.verbose = opts.verbose ?? false;
    this.toolRegistry = {};

    /** Debug logger */
    this.log = (...a)=>{ if (this.verbose) console.log("[agent]", ...a); };
    this._mcpAdapters = [];
  }

  async init() {
    this.log('Initializing agent...');
    for (const t of this.customTools) {
      this._registerTool(t);
      this.log(`Registered custom tool: ${t.name}`);
    }
    if (this.mcpServers.length) {
      for (const cfg of this.mcpServers) {
        this.log(`Connecting MCP server: ${cfg.name} (${cfg.url})`);
        const adapter = new MCPAdapter(cfg, { log: (m)=>this.log(`[mcp:${cfg.name}]`, m) });
        await adapter.connect();
        const mcpTools = await adapter.listTools();
        for (const mt of mcpTools) {
          const wrapped = {
            name: `${cfg.name}:${mt.name}`,
            description: mt.description || `MCP tool ${mt.name} from ${cfg.name}`,
            parameters: mt.inputSchema || { type: "object", properties: {}, additionalProperties: true },
            handler: async (args)=> await adapter.callTool(mt.name, args)
          };
          this._registerTool(wrapped);
          this.log(`Registered MCP tool: ${cfg.name}:${mt.name}`);
        }
        this._mcpAdapters.push(adapter);
      }
    }
    this.log('Agent initialization complete.');
  }

  _registerTool(tool) {
    if (!tool?.name) throw new Error("Tool must have a name");
    this.toolRegistry[tool.name] = tool;
  }

  _openAIToolsSpec() {
    const specs = Object.values(this.toolRegistry).map(t => ({
      type: "function",
      function: {
        name: t.name.slice(0,64),
        description: t.description?.slice(0, 1024) || "",
        parameters: t.parameters || { type: "object", properties: {}, additionalProperties: true }
      }
    }));
    this.log(`Prepared ${specs.length} tool specs for OpenAI.`);
    return specs;
  }

  async run(user, runOpts) {
    if (!this.apiKey) throw new Error("Missing apiKey");
    if (!this.model) throw new Error("Missing model");

    await this.init();

    const messages = [];
    if (this.system) messages.push({ role: "system", content: this.system });
    messages.push({ role: "user", content: user });

    let turn = 0;
    this.log(`Starting agent loop for model ${this.model}`);

    while (turn < this.maxTurns) {
      turn++;
      this.log(`Turn ${turn} start`);
      const res = await this._chat(messages, this._openAIToolsSpec());
      const msg = res?.choices?.[0]?.message;
      if (!msg) throw new Error("No message from model");

      messages.push(msg);
      this.log(`Model responded with role=${msg.role}`);

      const toolCalls = msg.tool_calls || [];
      if (toolCalls.length) {
        this.log(`Model issued ${toolCalls.length} tool calls`);
        const toExecute = toolCalls.slice(0, this.maxToolCallsPerTurn);
        for (const tc of toExecute) {
          const toolName = tc.function?.name;
          this.log(`Executing tool: ${toolName}`);
          let args = {};
          try { args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; }
          catch (_) { args = { _raw: tc.function?.arguments }; }

          const tool = this.toolRegistry[toolName];
          if (!tool) {
            const content = `Tool ${toolName} not found.`;
            messages.push({ role: "tool", tool_call_id: tc.id, content });
            this.log(`Tool ${toolName} not found.`);
            continue;
          }

          let result; let error = null;
          try {
            result = await tool.handler(args, { log: (m)=>this.log(`[tool:${toolName}]`, m) });
          } catch (e) {
            error = e instanceof Error ? e.message : String(e);
            this.log(`Error in tool ${toolName}:`, error);
          }

          const toolContent = error ? `__error__: ${error}` : (typeof result === "string" ? result : JSON.stringify(result));
          messages.push({ role: "tool", tool_call_id: tc.id, content: toolContent });
          this.log(`Tool ${toolName} completed.`);
        }
        continue;
      }

      const text = coerceText(msg.content);
      this.log(`Final response generated.`);
      return runOpts?.returnMessages ? { text, messages } : { text };
    }

    this.log(`Max turns reached (${this.maxTurns}).`);
    return { text: "[Stopped: maxTurns reached without a final answer]" };
  }

  async _chat(messages, tools) {
    const url = `${this.baseURL}/chat/completions`;
    const payload = { model: this.model, messages, tools, tool_choice: "auto", temperature: this.temperature };
    this.log(`Calling OpenAI API at ${url}`);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.apiKey}` },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const t = await res.text().catch(()=>"<no-body>");
      this.log(`OpenAI API error ${res.status}: ${t}`);
      throw new Error(`OpenAI API error ${res.status}: ${t}`);
    }

    const data = await res.json();
    this.log('Received OpenAI response.');
    return data;
  }
}

function coerceText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(part => (typeof part === "string" ? part : part?.text || "")).join("");
  if (content && typeof content === "object" && "text" in content) return content.text;
  return String(content ?? "");
}

class MCPAdapter {
  constructor(cfg, io) {
    this.cfg = cfg;
    this.log = io.log;
    this.client = null;
    this.transport = null;
  }

  async connect() {
    try {
      const mod = await import('@modelcontextprotocol/sdk/client');
      const wsMod = await import('@modelcontextprotocol/sdk/client/websocket');
      const { Client } = mod;
      const { WebSocketClientTransport } = wsMod;
      const url = this.cfg.url;
      const headers = this.cfg.headers || {};
      this.transport = new WebSocketClientTransport(url, { headers });
      await this.transport.connect();
      this.client = new Client(this.transport, { name: `super-minimal-agent:${this.cfg.name}`, version: '0.0.1' });
      this.log(`connected to ${url}`);
    } catch (e) {
      throw new Error(`Failed to load/connect MCP SDK: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async listTools() {
    if (!this.client) throw new Error('MCP not connected');
    const result = await this.client.listTools();
    return result?.tools || [];
  }

  async callTool(toolName, args) {
    if (!this.client) throw new Error('MCP not connected');
    const res = await this.client.callTool({ name: toolName, arguments: args });
    if (!res) return null;
    if (typeof res === 'string') return res;
    return res;
  }
}
