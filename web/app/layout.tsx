import type { Metadata } from 'next'
import { Archivo, Literata, Courier_Prime } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import './globals.css'
import { SessionProvider } from './session-provider'
import { ToastProvider } from '@/components/Toaster'

const archivo = Archivo({ subsets: ['latin'], variable: '--font-archivo' })
const literata = Literata({ subsets: ['latin'], variable: '--font-literata' })
const courierPrime = Courier_Prime({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-courier-prime' })

export const metadata: Metadata = {
  title: 'AI Superbrain',
  description: 'Your personal archive, with the references in between',
  manifest: '/manifest.json',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${archivo.variable} ${literata.variable} ${courierPrime.variable} font-sans`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <ErrorBoundary>
            <SessionProvider>
              <ToastProvider>{children}</ToastProvider>
            </SessionProvider>
          </ErrorBoundary>
        </ThemeProvider>
      </body>
    </html>
  )
}
