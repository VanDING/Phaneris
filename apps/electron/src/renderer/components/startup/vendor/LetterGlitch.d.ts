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
  loading?: boolean
  loadingColor?: string
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
  /** Freeze simulation time; redraws still apply changed settings. */
  paused?: boolean
  /** Called after each painted frame. */
  onFrame?: (time: number) => void
  className?: string
  style?: CSSProperties
}

export default function LetterGlitch(props: LetterGlitchProps): ReactElement
