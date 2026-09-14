interface PhanerisSymbolProps {
  className?: string
}

/**
 * Phaneris mark — the isometric glyph from `apps/electron/resources/icon.svg`,
 * the single source of truth for the brand mark.
 *
 * Rendered in `currentColor` so it adopts the theme accent (apply
 * `text-accent`), which is how the app chrome used the previous mark.
 */
export function PhanerisSymbol({ className }: PhanerisSymbolProps) {
  return (
    <svg
      viewBox="0 0 1000 1000"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <polygon points="180,270 500,90 500,270 330,365" fill="currentColor" />
      <polygon points="180,270 330,365 330,790 180,875" fill="currentColor" />
      <polygon points="500,90 760,235 610,320 500,270" fill="currentColor" />
      <polygon points="610,320 760,235 760,510 610,595" fill="currentColor" />
      <polygon points="380,555 610,425 610,595 380,725" fill="currentColor" />
    </svg>
  )
}
