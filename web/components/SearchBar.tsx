'use client'
import { useState, useEffect, useRef } from 'react'
import { GraphNode } from '@/lib/types'

interface Props {
  nodes: GraphNode[]
  onSelect: (id: string) => void
}

export function SearchBar({ nodes, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GraphNode[]>([])
  const [open, setOpen] = useState(false)
  const indexRef = useRef<any>(null)

  useEffect(() => {
    import('flexsearch').then(mod => {
      // FlexSearch Document index
      const FlexDocument = mod.Document ?? mod.default?.Document
      if (!FlexDocument) return
      const index = new FlexDocument({
        document: { id: 'id', index: ['title', 'tags'] },
      })
      nodes.forEach(n => index.add({ ...n, tags: n.tags.join(' ') }))
      indexRef.current = index
    })
  }, [nodes])

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setQuery(val)
    if (!val.trim() || !indexRef.current) {
      setResults([])
      setOpen(false)
      return
    }

    // flexsearch Document.search returns array of { field, result } objects
    const hits: any[] = indexRef.current.search(val, { limit: 8, enrich: true })
    const ids = new Set<string>()
    hits.forEach((field: any) => {
      field.result?.forEach((r: any) => {
        ids.add(typeof r === 'string' ? r : r.id)
      })
    })
    setResults(nodes.filter(n => ids.has(n.id)))
    setOpen(true)
  }

  function handleClose() {
    setQuery('')
    setResults([])
    setOpen(false)
  }

  return (
    <div className="relative w-72">
      <input
        type="search"
        value={query}
        onChange={handleInput}
        placeholder="Search notes..."
        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
      />
      {open && results.length > 0 && (
        <ul className="absolute top-full mt-1 left-0 right-0 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden z-50 shadow-xl">
          {results.map(n => (
            <li key={n.id}>
              <button
                onClick={() => {
                  onSelect(n.id)
                  handleClose()
                }}
                className="w-full text-left px-4 py-2 text-sm hover:bg-gray-700 flex items-center gap-2 transition"
              >
                <span className="truncate">{n.title}</span>
                <span className="text-xs text-gray-500 ml-auto shrink-0">{n.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
