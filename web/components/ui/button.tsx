'use client'
import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { clsx } from 'clsx'

// One button for the whole app: the same sizes everywhere, and a small press-down on click so the
// interface answers the moment you press. Only colour and scale transition, never `all`.
export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-1.5 shrink-0 rounded-md font-medium whitespace-nowrap select-none cursor-pointer',
    'transition-[color,background-color,border-color,opacity,scale] duration-150 ease-out',
    'active:scale-[0.97] motion-reduce:active:scale-100',
    'disabled:opacity-50 disabled:pointer-events-none',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-teal-600 text-white hover:bg-teal-500',
        secondary: 'bg-slate-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-slate-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200',
        outline: 'border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-800',
        ghost: 'text-slate-500 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100',
        ai: 'bg-violet-600 text-white hover:bg-violet-500',
        danger: 'bg-red-600 text-white hover:bg-red-500',
        /** A toggle that is on and asks for attention, like the open inbox */
        attention: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400',
      },
      size: {
        sm: 'h-7 px-2.5 text-[11px]',
        md: 'h-8 px-3 text-xs',
        icon: 'h-7 w-7',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = 'button', ...props }, ref,
) {
  return <button ref={ref} type={type} className={clsx(buttonVariants({ variant, size }), className)} {...props} />
})
