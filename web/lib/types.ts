// web/lib/types.ts

export interface VaultNote {
  path: string          // relative path in vault, e.g. "people/Milan.md"
  stem: string          // filename without extension, e.g. "Milan"
  title: string         // from frontmatter.title or stem
  type: 'person' | 'project' | 'idea' | 'note' | 'resource' | 'meeting' | 'daily' | 'area' | 'system'
  tags: string[]
  date: string | null
  content: string       // raw markdown (body only, no frontmatter)
  relations: TypedRelation[]
  wikilinks: string[]   // stems found in body [[...]]
}

export interface TypedRelation {
  target: string        // stem of target note
  type: string          // works_with | part_of | inspired_by | references
}

export interface GraphNode {
  id: string            // note stem (lowercased)
  path: string
  title: string
  type: VaultNote['type']
  tags: string[]
  hasDuplicateStem: boolean
}

export interface GraphEdge {
  source: string        // stem (lowercased)
  target: string        // stem (lowercased)
  typed: boolean
  relationType?: string
}

export interface VaultGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  notesByPath: Record<string, VaultNote>
  notesByStem: Record<string, VaultNote>
  builtAt: number
}
