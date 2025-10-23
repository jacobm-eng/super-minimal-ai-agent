// example.js
import { Agent } from './super-minimal-ai-agent.js';

const apiKey = process.env.OPENAI_API_KEY;

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
  model: 'gpt-4o-mini',
  apiKey,
  tools: [echoTool],
  maxTurns: 6,
  verbose: true
});

const { text } = await agent.run('Say hello, call the echo tool with message="hi", then summarize.');
console.log('Final:', text);
