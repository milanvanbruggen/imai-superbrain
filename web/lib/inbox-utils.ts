import type { GraphNode } from './types'

export function countInboxNodes(nodes: GraphNode[]): number {
  return nodes.filter(n => n.path.startsWith('inbox/')).length
}
