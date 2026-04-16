import type { GraphNode } from './types'

export function countInboxNodes(nodes: GraphNode[]): number {
  return nodes.filter(n => n.inbox).length
}
