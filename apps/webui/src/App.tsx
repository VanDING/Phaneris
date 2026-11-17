/**
 * Web UI App — thin wrapper that:
 * 1. Fetches WS config from the server
 * 2. Creates the web API adapter + sets window.electronAPI
 * 3. Delegates to the Electron renderer's App component
 *
 * Mobile responsiveness is handled by container queries and isAutoCompact
 * in the shared renderer components — no webui-specific layout hacks needed.
 */

import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { createWebApi } from './adapter/web-api'
import type { WsRpcClient } from '@phaneris/server-core/transport/client'
import { createClientPlatform, initializeClient } from '@/platform/client'
import { Button, Center, Cluster, Stack } from '@phaneris/ui'
import { ThemeProvider } from '@/context/ThemeContext'
import { windowWorkspaceIdAtom } from '@/atoms/sessions'
import { Toaster } from '@/components/ui/sonner'
import { StartupBoundary } from '@/components/SplashScreen'

// Lazy-load the Electron App after window.electronAPI is set up.
// This prevents any Electron component from accessing window.electronAPI
// before the web adapter is ready.
const ElectronApp = lazy(() => import('@/App'))

type Phase = 'loading' | 'error' | 'ready'

/** Theme effects read and subscribe only after initializeClient installs the API. */
function ConnectedApp() {
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)
  return (
    <ThemeProvider activeWorkspaceId={workspaceId}>
      <StartupBoundary>{onReady => <Suspense fallback={<LoadingScreen />}>
        <ElectronApp onReady={onReady} />
      </Suspense>}</StartupBoundary>
      <Toaster />
    </ThemeProvider>
  )
}

function LoadingScreen() {
  const { t } = useTranslation()

  return (
    <main className="h-screen font-sans text-text-secondary">
      <Center className="h-full">
        <Stack gap="md" align="center">
          <div className="animate-spin w-6 h-6 border-2 border-current border-t-transparent rounded-full" />
          <p className="text-body">{t("webui.connectingToServer")}</p>
        </Stack>
      </Center>
    </main>
  )
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation()

  return (
    <main className="h-screen font-sans text-text-secondary">
      <Center className="h-full">
        <Stack gap="md" align="center">
          <h1 className="text-reading font-medium text-destructive">{t("webui.connectionFailed")}</h1>
          {/* The raw failure used to be the only thing on this screen, so a server
              that answered with HTML produced `Unexpected token '<', "<!DOCTYPE "...`
              — a parser message the user cannot act on. The actionable sentence is
              now the copy; the exception is kept, but demoted to a disclosure. */}
          <p className="text-body max-w-md text-center">{t("webui.connectionFailedBody")}</p>
          <details className="max-w-md w-full">
            <summary className="text-meta text-text-secondary cursor-pointer text-center">
              {t("webui.connectionFailedDetails")}
            </summary>
            <p className="mt-2 text-meta text-text-secondary text-center break-words">{message}</p>
          </details>
          <Cluster gap="sm" className="mt-2">
            <Button variant="outline" onClick={onRetry}>
              {t("common.retry")}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                fetch('/api/auth/logout', { method: 'POST' }).then(() => {
                  window.location.href = '/login'
                })
              }}
            >
              {t("webui.logOut")}
            </Button>
          </Cluster>
        </Stack>
      </Center>
    </main>
  )
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')
  const clientRef = useRef<WsRpcClient | null>(null)
  const initialization = useRef<AbortController | null>(null)

  const initialize = useCallback(async () => {
    initialization.current?.abort()
    const controller = new AbortController()
    initialization.current = controller
    setPhase('loading')
    setError('')

    try {
      // 1. Fetch WS URL from the server (cookie auth)
      const configRes = await fetch('/api/config', { credentials: 'same-origin', signal: controller.signal })
      if (!configRes.ok) {
        if (configRes.status === 401) {
          // Session expired — redirect to login
          window.location.href = '/login'
          return
        }
        throw new Error(`Failed to fetch config: ${configRes.status}`)
      }

      const { wsUrl } = await configRes.json() as { wsUrl: string }
      if (!wsUrl) throw new Error('Server did not return a WebSocket URL')

      // 2. Determine workspace — check URL params first
      const params = new URLSearchParams(window.location.search)
      let workspaceId = params.get('workspace') ?? undefined

      // If no workspace in URL, fetch the default from the server
      // so we can include it in the WebSocket handshake
      if (!workspaceId) {
        try {
          const linkedSlug = params.get('ws')
          const query = linkedSlug ? `?ws=${encodeURIComponent(linkedSlug)}` : ''
          const wsRes = await fetch(`/api/config/workspaces${query}`, { credentials: 'same-origin', signal: controller.signal })
          if (wsRes.ok) {
            const { defaultWorkspaceId } = await wsRes.json() as { defaultWorkspaceId?: string }
            if (defaultWorkspaceId) workspaceId = defaultWorkspaceId
          }
        } catch {
          // Non-fatal — workspace will be set via switchWorkspace later
        }
      }

      // 3. Create web API adapter
      // Destroy previous client on retry
      if (clientRef.current) {
        clientRef.current.destroy()
      }

      const { api, client } = createWebApi({ serverUrl: wsUrl, workspaceId })
      if (controller.signal.aborted) { client.destroy(); return }
      clientRef.current = client

      // Connect and initialize the finite platform before loading business components.
      client.connect()
      await initializeClient(createClientPlatform('web', api), api, controller.signal)
      setPhase('ready')
    } catch (err) {
      if (controller.signal.aborted) return
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setPhase('error')
    }
  }, [])

  useEffect(() => {
    void initialize()

    return () => {
      // Cleanup on unmount
      initialization.current?.abort()
      clientRef.current?.destroy()
    }
  }, [initialize])

  if (phase === 'loading') return <LoadingScreen />
  if (phase === 'error') return <ErrorScreen message={error} onRetry={initialize} />

  return <ConnectedApp />
}


