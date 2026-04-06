'use client'
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { GraphNode } from '@/lib/types'

interface Props {
  nodes: GraphNode[]
  onSelect: (id: string) => void
}

const TYPE_DOTS: Record<string, string> = {
  person: 'bg-blue-400', project: 'bg-emerald-400', idea: 'bg-amber-400',
  resource: 'bg-violet-400', note: 'bg-slate-400', meeting: 'bg-cyan-400',
  daily: 'bg-gray-400', area: 'bg-pink-400', group: 'bg-orange-400',
  system: 'bg-gray-400', template: 'bg-purple-400',
}

export function SearchBar({ nodes, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GraphNode[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 })
  const indexRef = useRef<any>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    import('flexsearch').then(mod => {
      const FlexDocument = mod.Document ?? mod.default?.Document
      if (!FlexDocument) return
      const index = new FlexDocument({
        document: { id: 'id', index: ['title', 'tags'] },
      })
      nodes.forEach(n => index.add({ ...n, tags: n.tags.join(' ') }))
      indexRef.current = index
    })
  }, [nodes])

  function updateDropdownPos() {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect()
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setQuery(val)
    setActiveIndex(-1)
    if (!val.trim() || !indexRef.current) {
      setResults([])
      setOpen(false)
      return
    }
    updateDropdownPos()
    const hits: any[] = indexRef.current.search(val, { limit: 8, enrich: true })
    const ids = new Set<string>()
    hits.forEach((field: any) => {
      field.result?.forEach((r: any) => ids.add(typeof r === 'string' ? r : r.id))
    })
    setResults(nodes.filter(n => ids.has(n.id)))
    setOpen(true)
  }

  function handleClose() {
    setQuery('')
    setResults([])
    setOpen(false)
    setActiveIndex(-1)
  }

  function handleSelect(id: string, e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation()
    onSelect(id)
    handleClose()
    inputRef.current?.blur()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => (i - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = results[activeIndex] ?? results[0]
      if (target) handleSelect(target.id, e)
    } else if (e.key === 'Escape') {
      handleClose()
    }
  }

  // Close on click outside
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) {
        handleClose()
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="relative w-56">
      <div className="relative">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-600 pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Search notes..."
          className="w-full pl-8 pr-3 py-1.5 bg-slate-100 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 rounded-md text-xs text-gray-900 dark:text-white placeholder-slate-400 dark:placeholder-gray-600 focus:outline-none focus:border-teal-400 dark:focus:border-teal-600 transition-colors"
        />
      </div>

      {/* Portal dropdown — renders in document.body to escape any stacking context */}
      {open && results.length > 0 && typeof document !== 'undefined' && createPortal(
        <ul
          style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, zIndex: 9999 }}
          className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-md overflow-hidden shadow-xl"
        >
          {results.map((n, i) => (
            <li key={n.id}>
              <button
                onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
                onClick={e => handleSelect(n.id, e)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors cursor-pointer ${
                  i === activeIndex
                    ? 'bg-slate-100 dark:bg-gray-800'
                    : 'hover:bg-slate-50 dark:hover:bg-gray-800'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TYPE_DOTS[n.type] ?? 'bg-slate-400'}`} />
                <span className="truncate text-gray-700 dark:text-slate-300">{n.title}</span>
                <span className="text-slate-400 dark:text-gray-600 ml-auto shrink-0">{n.type}</span>
              </button>
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  )
}
