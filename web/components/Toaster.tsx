'use client'
import { createContext, useCallback, useContext, useState } from 'react'

type ToastType = 'success' | 'error' | 'info'
interface ToastItem { id: string; message: string; type: ToastType }
type AddToast = (message: string, type?: ToastType) => void

const ToastContext = createContext<AddToast>(() => {})
export function useToast() { return useContext(ToastContext) }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const addToast = useCallback<AddToast>((message, type = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(
      () => setToasts(prev => prev.filter(t => t.id !== id)),
      type === 'error' ? 5000 : 3000
    )
  }, [])

  function dismiss(id: string) {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none">
          {toasts.map(t => (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-center gap-2.5 pl-3.5 pr-2.5 py-2.5 rounded-lg shadow-lg text-xs font-medium border transition-all ${
                t.type === 'success'
                  ? 'bg-teal-600 text-white border-teal-500'
                  : t.type === 'error'
                    ? 'bg-red-600 text-white border-red-500'
                    : 'bg-gray-900 text-white border-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-200'
              }`}
            >
              {t.type === 'success' && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
              {t.type === 'error' && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              )}
              <span>{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                className="ml-1 opacity-60 hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                aria-label="Dismiss"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  )
}
