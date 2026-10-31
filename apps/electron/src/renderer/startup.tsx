import { useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { SplashScreen } from './components/SplashScreen'

declare global {
  interface Window { playStartupLogo?: () => Promise<void> }
}

/** No preload, Node or transport. Only the main process can request the reveal. */
function Startup() {
  const [ready, setReady] = useState(false)
  const [complete, setComplete] = useState<() => void>(() => () => {})
  window.playStartupLogo = () => new Promise<void>(resolve => {
    setComplete(() => resolve)
    setReady(true)
  })
  const onComplete = useCallback(() => complete(), [complete])
  return <SplashScreen ready={ready} native onExitComplete={onComplete} />
}

flushSync(() => createRoot(document.getElementById('root')!).render(<Startup />))
