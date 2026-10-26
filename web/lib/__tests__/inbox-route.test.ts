import { describe, it, expect } from 'vitest'
import { countInboxNodes } from '../inbox-utils'
import type { GraphNode } from '../types'

function makeNode(path: string, inbox = false): GraphNode {
  return { id: path, path, title: path, type: 'note', tags: [], hasDuplicateStem: false, inbox }
}

describe('countInboxNodes', () => {
  it('counts nodes flagged with inbox: true in frontmatter', () => {
    const nodes: GraphNode[] = [
      makeNode('notes/quick-thought.md', true),
      makeNode('people/Jan.md', true),
      makeNode('people/Milan.md'),
      makeNode('projects/superbrain.md'),
    ]
    expect(countInboxNodes(nodes)).toBe(2)
  })

  it('ignores the folder — only the frontmatter flag counts', () => {
    const nodes: GraphNode[] = [makeNode('inbox/legacy.md')]
    expect(countInboxNodes(nodes)).toBe(0)
  })

  it('returns 0 when no node is flagged', () => {
    const nodes: GraphNode[] = [makeNode('people/Milan.md')]
    expect(countInboxNodes(nodes)).toBe(0)
  })

  it('returns 0 for empty node list', () => {
    expect(countInboxNodes([])).toBe(0)
  })
})
