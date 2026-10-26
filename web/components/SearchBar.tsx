'use client'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Command } from 'cmdk'
import { Dialog } from '@base-ui/react/dialog'
import { GraphNode } from '@/lib/types'
import { rankPaletteItem as rank } from '@/lib/palette-rank'

export interface PaletteAction {
  id: string
  label: string
  run: () => void
}

interface Props {
  nodes: GraphNode[]
  onSelect: (id: string) => void
  /** App commands offered next to the notes (new note, inbox, settings…) */
  actions?: PaletteAction[]
  typeColors?: Record<string, string>
}

// Search as a command palette (cmdk): ⌘K or a click on the field opens it. It opens and closes
// without animation, on purpose: something you open many times a day should never make you wait.
export function SearchBar({ nodes, onSelect, actions = [], typeColors = {} }: Props) {
  const [open, setOpen] = useState(false)
  const isMac = useSyncExternalStore(noSubscribe, () => /Mac|iPhone|iPad/.test(navigator.platform), () => true)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function choose(fn: () => void) {
    setOpen(false)
    fn()
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        onClick={e => e.stopPropagation()}
        className="group flex items-center gap-2 w-56 h-8 pl-2.5 pr-1.5 bg-slate-100 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 rounded-md text-xs text-slate-400 dark:text-gray-500 cursor-pointer transition-colors hover:border-slate-300 dark:hover:border-gray-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <span className="flex-1 text-left">Search notes…</span>
        <kbd className="font-sans text-[10px] px-1.5 py-0.5 rounded border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-slate-400 dark:text-gray-500">
          {isMac ? '⌘' : 'Ctrl'} K
        </kbd>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 dark:bg-black/60" />
        <Dialog.Popup
          aria-label="Search"
          className="fixed left-1/2 top-[15vh] z-50 -translate-x-1/2 w-[min(560px,calc(100vw-2rem))] outline-none"
        >
          <Command
            loop
            filter={rank}
            className="overflow-hidden rounded-xl border border-slate-200 dark:border-gray-700/80 bg-white dark:bg-gray-900 shadow-2xl"
          >
            <div className="flex items-center gap-2 px-4 border-b border-slate-100 dark:border-gray-800">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-slate-400 dark:text-gray-500">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <Command.Input
                autoFocus
                placeholder="Search notes or type a command…"
                className="flex-1 h-12 bg-transparent text-sm text-gray-900 dark:text-white placeholder-slate-400 dark:placeholder-gray-600 outline-none"
              />
            </div>
            <Command.List className="max-h-[min(400px,60vh)] overflow-y-auto overscroll-contain p-1.5 scroll-py-1.5">
              <Command.Empty className="py-8 text-center text-xs text-slate-400 dark:text-gray-500">No notes found</Command.Empty>
              {actions.length > 0 && (
                <Command.Group heading="Actions" className={GROUP}>
                  {actions.map(a => (
                    <Command.Item key={a.id} value={`action:${a.id}`} keywords={[a.label]} onSelect={() => choose(a.run)} className={ITEM}>
                      <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-teal-500" />
                      <span className="truncate">{a.label}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading="Notes" className={GROUP}>
                {nodes.map(n => (
                  <Command.Item
                    key={n.id}
                    value={n.id}
                    keywords={[n.title, n.type, ...n.tags].map(String)}
                    onSelect={() => choose(() => onSelect(n.id))}
                    className={ITEM}
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: typeColors[n.type] ?? '#94a3b8' }} />
                    <span className="truncate">{n.title}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-slate-400 dark:text-gray-500">{n.type}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const noSubscribe = () => () => {}


const GROUP = 'palette-group'
const ITEM = 'flex items-center gap-2.5 px-2.5 h-9 rounded-md text-xs text-gray-700 dark:text-slate-300 cursor-pointer select-none data-[selected=true]:bg-slate-100 dark:data-[selected=true]:bg-gray-800 data-[selected=true]:text-gray-900 dark:data-[selected=true]:text-white'
