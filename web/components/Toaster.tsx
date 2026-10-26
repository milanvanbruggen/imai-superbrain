'use client'
import { Toaster as Sonner, toast } from 'sonner'
import { useTheme } from 'next-themes'

type ToastType = 'success' | 'error' | 'info'
type AddToast = (message: string, type?: ToastType) => void

// Toasts are Sonner's; this keeps the app's toast(message, type) call as it was.
const addToast: AddToast = (message, type = 'success') => {
  if (type === 'error') toast.error(message)
  else if (type === 'success') toast.success(message)
  else toast(message)
}

export function useToast(): AddToast {
  return addToast
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme()
  return (
    <>
      {children}
      <Sonner
        theme={resolvedTheme === 'light' ? 'light' : 'dark'}
        position="bottom-right"
        closeButton
        toastOptions={{ classNames: { toast: 'text-xs font-medium' } }}
      />
    </>
  )
}
