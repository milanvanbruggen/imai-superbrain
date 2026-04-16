import { NextRequest } from 'next/server'
import { watch } from 'fs'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return new Response('Unauthorized', { status: 401 })

  const vaultPath = process.env.VAULT_PATH
  if (!vaultPath) return new Response('No local vault configured', { status: 404 })

  const encoder = new TextEncoder()
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
      c.enqueue(encoder.encode('data: connected\n\n'))

      const watcher = watch(vaultPath, { recursive: true }, (_event, filename) => {
        if (typeof filename !== 'string' || !filename.endsWith('.md')) return
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          try { c.enqueue(encoder.encode('data: change\n\n')) } catch {}
        }, 300)
      })

      req.signal.addEventListener('abort', () => {
        if (debounceTimer) clearTimeout(debounceTimer)
        watcher.close()
        try { c.close() } catch {}
      })
    },
    cancel() {
      if (debounceTimer) clearTimeout(debounceTimer)
      controller = null
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
