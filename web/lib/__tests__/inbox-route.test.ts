import { describe, it, expect } from 'vitest'
import { countInboxNodes } from '../inbox-utils'
import type { GraphNode } from '../types'

function makeNode(path: string): GraphNode {
  return { id: path, path, title: path, type: 'note', tags: [], hasDuplicateStem: false }
}

describe('countInboxNodes', () => {
  it('counts nodes with path starting with inbox/', () => {
    const nodes: GraphNode[] = [
      makeNode('inbox/quick-thought.md'),
      makeNode('inbox/another.md'),
      makeNode('people/Milan.md'),
      makeNode('projects/superbrain.md'),
    ]
    expect(countInboxNodes(nodes)).toBe(2)
  })

  it('returns 0 when inbox is empty', () => {
    const nodes: GraphNode[] = [makeNode('people/Milan.md')]
    expect(countInboxNodes(nodes)).toBe(0)
  })

  it('returns 0 for empty node list', () => {
    expect(countInboxNodes([])).toBe(0)
  })
})
