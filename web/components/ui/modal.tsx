'use client'
import { useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { clsx } from 'clsx'

interface ModalProps {
  /** Called once the modal has finished closing (after its exit animation) */
  onClose: () => void
  /** Accessible name, for modals without a visible <ModalTitle> */
  label?: string
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}

// A modal on Base UI's Dialog: focus is trapped and returned, Escape and a click outside close it,
// and it scales in from 0.96 with a fade (never from 0), leaving a little faster than it came.
// The parent still mounts it with {show && <X onClose />}: it opens on mount and calls onClose
// when it has animated out.
export function Modal({ onClose, label, className, style, children }: ModalProps) {
  const [open, setOpen] = useState(true)
  return (
    <Dialog.Root
      open={open}
      onOpenChange={next => { if (!next) setOpen(false) }}
      onOpenChangeComplete={next => { if (!next) onClose() }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          className={clsx(
            'fixed inset-0 z-50 bg-black/50 dark:bg-black/70 backdrop-blur-sm',
            'transition-opacity duration-200 ease-out data-[ending-style]:duration-150',
            'data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
          )}
        />
        <Dialog.Popup
          aria-label={label}
          style={style}
          className={clsx(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] outline-none',
            'bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700/80 rounded-xl shadow-2xl',
            'transition-[opacity,scale] duration-200 ease-out data-[ending-style]:duration-150',
            'data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.96]',
            'data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.96]',
            'motion-reduce:data-[starting-style]:scale-100 motion-reduce:data-[ending-style]:scale-100',
            className,
          )}
        >
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Closes the surrounding modal with its exit animation. Takes the button it should render as. */
export const ModalClose = Dialog.Close
export const ModalTitle = Dialog.Title
