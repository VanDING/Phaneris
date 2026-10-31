import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { PhanerisSymbol } from './icons/PhanerisSymbol'
import LetterGlitch from './startup/vendor/LetterGlitch.jsx'
import './startup/startup.css'

interface SplashScreenProps {
  ready: boolean
  onExitComplete: () => void
  /** The early native surface fades its whole window at handoff. */
  native?: boolean
}

/** Shared by the Electron and browser shells; survives App's loading branches. */
export function StartupBoundary({ children }: { children: (onReady: () => void) => ReactNode }) {
  const [requested, setRequested] = useState(false)
  const [ready, setReady] = useState(false)
  const [hidden, setHidden] = useState(!!window.electronAPI.startupManaged)
  const markReady = useCallback(() => setRequested(true), [])
  const hideStartup = useCallback(() => setHidden(true), [])
  useEffect(() => {
    if (!requested) return
    let cancelled = false
    void (async () => {
      const native = await window.electronAPI.completeStartup?.()
      if (cancelled) return
      if (native) setHidden(true)
      else { setHidden(false); setReady(true) }
    })()
    return () => { cancelled = true }
  }, [requested])
  return <>{children(markReady)}{!hidden && <SplashScreen ready={ready} onExitComplete={hideStartup} />}</>
}

/** Fixed white brand surface; it never changes the workspace's theme. */
export function SplashScreen({ ready, onExitComplete, native = false }: SplashScreenProps) {
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [painted, setPainted] = useState(false)
  const [contextLost, setContextLost] = useState(false)
  const field = useRef<HTMLDivElement>(null)
  const [exiting, setExiting] = useState(false)
  const paintedFrame = useCallback(() => setPainted(true), [])
  useEffect(() => {
    const canvas = field.current?.querySelector('canvas')
    const lost = () => setContextLost(true)
    canvas?.addEventListener('webglcontextlost', lost)
    return () => canvas?.removeEventListener('webglcontextlost', lost)
  }, [])
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const entranceComplete = useCallback(() => {
    if (native || reduced) onExitComplete()
    else setExiting(true)
  }, [native, reduced, onExitComplete])
  useEffect(() => {
    if (ready && reduced) entranceComplete()
  }, [ready, reduced, entranceComplete])
  return (
    <div data-testid="app-splash" data-startup-phase={exiting ? 'exiting' : ready ? 'revealing' : 'loading'}
      className={`startup-surface${exiting ? ' startup-exiting' : ''}`}
      onAnimationEnd={event => {
        if (event.target === event.currentTarget && exiting) onExitComplete()
      }}>
      {(!painted || contextLost) && <div className="startup-fallback" aria-hidden="true">
        {Array.from({ length: 64 }, (_, row) => <div key={row}>
          {'P7/AF[]9X;N=4Z<>01+R:*B6&Q_'.repeat(12).slice(row % 19)}
        </div>)}
      </div>}
      <div ref={field} className="startup-field" aria-hidden="true">
        {!contextLost && <LetterGlitch lightMode baseColor="#766a83" glitchColors={['#7851a9', '#9879b7', '#533665']}
          fontSize={15} spacing={0.65} density={0.85} baseOpacity={0.17} glitchAmount={0.2076}
          speed={reduced ? 0 : 0.55} smooth interactive={!reduced} cursorRadius={140} clickEffect="tear"
          flow={0.4} edgeFade={0.08} centerFade={0} intro={!reduced} paused={reduced && painted}
          onFrame={paintedFrame} dpr={Math.min(devicePixelRatio || 1, 1.5)}
          backgroundColor={undefined} style={undefined} />}
      </div>
      {ready && <div className="startup-logo" aria-hidden="true" data-testid="startup-logo">
        <PhanerisSymbol className="startup-quiet" />
        <div className="startup-ink" onAnimationEnd={event => {
          if (event.target === event.currentTarget) entranceComplete()
        }}><PhanerisSymbol tone="accent" /></div>
        <PhanerisSymbol className="startup-trace" />
      </div>}
    </div>
  )
}
