import type { CSSProperties, HTMLAttributes, ReactElement } from 'react'

/** Vendored react-bits Letter Glitch (MIT + Commons Clause, see resources/licenses). */
export interface LetterGlitchProps extends HTMLAttributes<HTMLDivElement> {
  glitchColors?: string[]
  baseColor?: string
  characters?: string
  fontFamily?: string
  fontSize?: number
  spacing?: number
  density?: number
  baseOpacity?: number
  glitchAmount?: number
  speed?: number
  smooth?: boolean
  interactive?: boolean
  cursorRadius?: number
  clickEffect?: 'tear' | 'burst' | 'none'
  flow?: number
  edgeFade?: number
  centerFade?: number
  intro?: boolean
  lightMode?: boolean
  backgroundColor?: string
  dpr?: number
  /** Freeze the animation loop without unmounting the surface. */
  paused?: boolean
  /** Called after each painted frame. */
  onFrame?: () => void
  className?: string
  style?: CSSProperties
}

export default function LetterGlitch(props: LetterGlitchProps): ReactElement
