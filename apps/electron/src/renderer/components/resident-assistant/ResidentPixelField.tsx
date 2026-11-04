import * as React from 'react'

const CELLS = Array.from({ length: 72 * 8 }, (_, index) => {
  const x = index % 72
  const y = Math.floor(index / 72)
  const noise = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return { x, y, seed: noise - Math.floor(noise) }
})

/** One clock drives every cell. Compact entries crop the same 4px pixel field. */
export function ResidentPixelField({ isDark, lifted }: { isDark: boolean; lifted: boolean }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const liftedRef = React.useRef(lifted)
  liftedRef.current = lifted

  React.useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const style = getComputedStyle(canvas)
    const palette = Array.from({ length: isDark ? 4 : 6 }, (_, index) => style.getPropertyValue(`--resident-pixel-${index}`).trim())
    let frame = 0
    let visible = false
    let last = 0
    let elapsed = 0.6
    let previous = 0

    const draw = (time: number) => {
      context.clearRect(0, 0, 360, 40)
      for (const { x, y, seed } of CELLS) {
        const wave = 0.5 + 0.5 * Math.sin(x * 0.34 + y * 0.72 - time * 1.2)
        const scan = Math.max(0, Math.sin(x * 0.17 - time * 2.2 + y * 0.3)) ** 8
        const pulse = 0.5 + 0.5 * Math.sin(time * (1.05 + seed * 2.1) + seed * 8.7)
        const lift = liftedRef.current ? 0.06 : 0
        if (isDark) {
          context.globalAlpha = 0.22 + 0.3 * wave + 0.18 * scan + 0.2 * pulse + lift
          context.fillStyle = palette[Math.floor(seed * 4)]!
        } else {
          // The strong group is ~42%; every quiet cell still shares wave/scan/pulse.
          const strength = seed > 0.58
            ? 3 + Math.min(2, Math.floor((0.48 * pulse + 0.28 * wave + 0.24 * scan + lift) * 3))
            : Math.min(2, Math.floor((0.55 * pulse + 0.3 * wave + 0.15 * scan) * 3))
          context.fillStyle = palette[strength]!
        }
        context.fillRect(x * 5, y * 5, 4, 4)
      }
      context.globalAlpha = 1
    }
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(360 * dpr)
      canvas.height = Math.round(40 * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.imageSmoothingEnabled = false
      draw(reduced.matches ? 0.6 : elapsed)
    }
    const loop = (now: number) => {
      if (previous) elapsed += (now - previous) / 1000
      previous = now
      if (now - last >= 40) { draw(elapsed); last = now }
      frame = requestAnimationFrame(loop)
    }
    const sync = () => {
      cancelAnimationFrame(frame)
      frame = 0
      previous = 0
      if (!visible || document.hidden) return
      resize()
      if (!reduced.matches) frame = requestAnimationFrame(loop)
    }
    const observer = new IntersectionObserver(([entry]) => { visible = entry!.isIntersecting; sync() })
    observer.observe(canvas)
    window.addEventListener('resize', sync)
    document.addEventListener('visibilitychange', sync)
    reduced.addEventListener('change', sync)
    resize()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', sync)
      document.removeEventListener('visibilitychange', sync)
      reduced.removeEventListener('change', sync)
    }
  }, [isDark])

  return <canvas ref={canvasRef} className="resident-pixels" aria-hidden="true" />
}
