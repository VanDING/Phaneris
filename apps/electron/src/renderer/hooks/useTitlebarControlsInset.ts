import { useEffect } from 'react'

/**
 * Publish the width of the Windows caption-button area as a CSS custom property.
 *
 * With `titleBarOverlay`, Windows draws minimise/maximise/close in the top-right
 * of the window and reserves that strip: nothing the app paints there is
 * clickable, and system symbols are composited on top of app content. Electron
 * exposes the safe region as CSS environment variables (`titlebar-area-*`), but
 * they are only readable from CSS — a probe element converts them into a number
 * the renderer can hand to any surface that puts controls in that corner.
 *
 * On macOS the traffic lights sit on the left and fullscreen overlays hide them
 * outright, so the probe resolves to 0 and nothing moves. The same is true in
 * the Web UI and in any non-overlay window: the `env()` fallbacks put the probe
 * at the full viewport width, and the reserve comes out as zero.
 *
 * Kept imperative rather than stateful on purpose — the value is consumed by
 * CSS, and re-rendering every consumer on window resize would be pure overhead.
 */
export function useTitlebarControlsInset(): void {
  useEffect(() => {
    const probe = document.createElement('div')
    probe.setAttribute('aria-hidden', 'true')
    // `visibility: hidden` (not `display: none`) so layout still runs and the
    // rect is measurable.
    Object.assign(probe.style, {
      position: 'fixed',
      top: '0',
      left: 'env(titlebar-area-x, 0px)',
      width: 'env(titlebar-area-width, 100%)',
      height: '0',
      visibility: 'hidden',
      pointerEvents: 'none',
      zIndex: '-1',
    })
    document.body.appendChild(probe)

    const apply = () => {
      const rect = probe.getBoundingClientRect()
      const inset = Math.max(0, Math.round(window.innerWidth - rect.right))
      document.documentElement.style.setProperty('--titlebar-controls-inset', `${inset}px`)
    }

    apply()
    // The reserved strip changes on resize, maximise/restore and fullscreen,
    // all of which surface as a window resize.
    window.addEventListener('resize', apply)
    return () => {
      window.removeEventListener('resize', apply)
      probe.remove()
      document.documentElement.style.removeProperty('--titlebar-controls-inset')
    }
  }, [])
}
