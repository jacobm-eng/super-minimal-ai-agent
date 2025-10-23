"An LLM agent runs tools in a loop to achieve a goal." --Simon Willison, [blog](https://simonwillison.net/2025/Sep/18/agents/)

# super-minimal-ai-agent

A tiny, turn-based AI Agent runner for the OpenAI API with optional [MCP](https://modelcontextprotocol.io/) tool support and plug-and-play custom JS tools.

* **Zero build**, single-file library (`super-minimal-ai-agent.js`).
* **Turn-based** function-calling loop with guardrails (`maxTurns`, `maxToolCallsPerTurn`).
* **Custom tools** or **MCP tools** exposed to the model automatically.
* ESM, Node 18+ (uses native `fetch`).

## Quick start

```bash
# 1) clone or copy the two files
#    - super-minimal-ai-agent.js (the library)
#    - example.js                (a tiny demo script)

# 2) set your OpenAI API key
export OPENAI_API_KEY=sk-your-key

# 3) run the example
node example.js
```

If everything is wired correctly, you’ll see an assistant response that calls the `echo` tool and summarizes the result.

## Files

* `super-minimal-ai-agent.js` — the library (contains `Agent` and a minimal `MCPAdapter`).
* `example.js` — runnable demo that imports the library, registers a custom tool, and performs a short turn-based run.
* `LICENSE` — MIT License.

## Installation options

**Option A: Drop-in**
Copy `super-minimal-ai-agent.js` into your project and import it.

**Option B: Local path import**
Keep the file next to your script and import via `./super-minimal-ai-agent.js`.

## Usage

### 1) Create tools

You can expose **custom JS tools** by providing a name, description, JSON‑Schema parameters, and a `handler(args, ctx)` function. Tools are surfaced to OpenAI via function calling.

```js
// echoTool.js (inline in example.js for simplicity)
export const echoTool = {
  name: 'echo',
  description: 'Echoes back the provided message.',
  parameters: {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message']
  },
  handler: async (args, ctx) => {
    ctx.log?.(`echoing: ${args.message}`);
    return { echoed: args.message, at: new Date().toISOString() };
  }
};
```

### 2) Instantiate and run the Agent

```js
import { Agent } from './super-minimal-ai-agent.js';
import { echoTool } from './echoTool.js'; // or inline it

const agent = new Agent({
  system: 'You are a helpful, tool-using assistant. Be concise.',
  model: 'gpt-4.1',
  apiKey: process.env.OPENAI_API_KEY,
  tools: [echoTool],
  maxTurns: 6,                 // guardrail: stop after 6 rounds
  maxToolCallsPerTurn: 3       // guardrail: limit tool call fan-out
});

const { text } = await agent.run(
  'Say hello, then call the echo tool with message="hi", then summarize the result.'
);
console.log('Final:', text);
```

### 3) Optional: Connect to MCP servers

Pass `mcpServers` to auto‑expose remote MCP tools (over WebSocket) to the model.

```js
const agent = new Agent({
  /* ... */
  mcpServers: [
    { name: 'local', url: 'ws://localhost:3000', headers: { Authorization: 'Bearer TOKEN' } }
  ]
});
```

Behind the scenes the agent will `listTools()` and wrap each MCP tool as a function-callable tool: `local:toolName`.

> Note: You need `@modelcontextprotocol/sdk` installed in your project if you plan to use MCP:
>
> ```bash
> npm i @modelcontextprotocol/sdk
> ```

## API

### `new Agent(options)`

**Required**

* `model`: string — OpenAI model (e.g., `gpt-4.1`, `gpt-4o`).
* `apiKey`: string — OpenAI API key.

**Recommended**

* `system`: string — System prompt to set behavior and role.

**Optional**

* `baseURL`: string — Custom API base (default `https://api.openai.com/v1`).
* `temperature`: number (default `0.2`).
* `maxTurns`: number (default `8`).
* `maxToolCallsPerTurn`: number (default `4`).
* `tools`: `CustomTool[]` — array of custom JS tools.
* `mcpServers`: `MCPServerConfig[]` — array of MCP server configs.
* `onToken(text)` — placeholder for future streaming hook.

### `await agent.run(userPrompt, { returnMessages })`

Runs the turn-based loop until the model emits a message **without** tool calls or `maxTurns` is reached.

Returns `{ text }` or `{ text, messages }` when `returnMessages: true`.

## How it works (under the hood)

1. Build the `messages` array: `[system?, user]`.
2. Call OpenAI **Chat Completions** with the tool specs derived from your tool registry.
3. If the model returns `tool_calls`, the agent executes each tool (capped by `maxToolCallsPerTurn`), pushes the tool results as `role: "tool"` messages, and loops.
4. If the model returns **no** `tool_calls`, that message is treated as the final answer and returned.
5. The loop stops when `maxTurns` is reached and returns a guardrail message.

## Example script

A self-contained demo is included in `example.js`.

```js
// example.js
import { Agent } from './super-minimal-ai-agent.js';

const echoTool = {
  name: 'echo',
  description: 'Echoes back the provided message.',
  parameters: {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message']
  },
  handler: async (args) => ({ echoed: args.message, at: new Date().toISOString() })
};

const agent = new Agent({
  system: 'You are a helpful assistant. Use tools when useful.',
  model: 'gpt-4.1',
  apiKey: process.env.OPENAI_API_KEY,
  tools: [echoTool],
  maxTurns: 6,
  verbose: true
});

const { text } = await agent.run('Say hello, call the echo tool with message="hi", then summarize.');
console.log('Final:', text);
```

Run it with:

```bash
export OPENAI_API_KEY=sk-your-key
node example.js
```

Example output:

```
node example.js
[agent] Initializing agent...
[agent] Registered custom tool: echo
[agent] Agent initialization complete.
[agent] Starting agent loop for model gpt-4o-mini
[agent] Turn 1 start
[agent] Prepared 1 tool specs for OpenAI.
[agent] Calling OpenAI API at https://api.openai.com/v1/chat/completions
[agent] Received OpenAI response.
[agent] Model responded with role=assistant
[agent] Model issued 2 tool calls
[agent] Executing tool: echo
[agent] Tool echo completed.
[agent] Executing tool: echo
[agent] Tool echo completed.
[agent] Turn 2 start
[agent] Prepared 1 tool specs for OpenAI.
[agent] Calling OpenAI API at https://api.openai.com/v1/chat/completions
[agent] Received OpenAI response.
[agent] Model responded with role=assistant
[agent] Final response generated.
Final: I said "hello" and called the echo tool with the message "hi." The responses were:

- "hi"
- "hello"

Both messages were echoed back successfully.
```

## License

This project is released under the **MIT License**. See `LICENSE` for details.
