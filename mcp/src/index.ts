import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { VaultReader } from './vault-reader.js'
import { createSearchTool } from './tools/search-notes.js'
import { createReadTool } from './tools/read-note.js'
import { createWriteTool } from './tools/write-note.js'
import { createGetRelatedTool } from './tools/get-related.js'
import { createListTool } from './tools/list-notes.js'
import { createGetContextTool } from './tools/get-context.js'
import { createGetIndexTool } from './tools/get-index.js'

const vault = new VaultReader()

const tools = [
  createSearchTool(vault),
  createReadTool(vault),
  createWriteTool(vault),
  createGetRelatedTool(vault),
  createListTool(vault),
  createGetContextTool(vault),
  createGetIndexTool(vault),
]

const server = new Server(
  { name: 'superbrain', version: '0.1.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}))

server.setRequestHandler(CallToolRequestSchema, async req => {
  const tool = tools.find(t => t.name === req.params.name)
  if (!tool) throw new Error(`Unknown tool: ${req.params.name}`)
  const result = await tool.execute(req.params.arguments as any)
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
