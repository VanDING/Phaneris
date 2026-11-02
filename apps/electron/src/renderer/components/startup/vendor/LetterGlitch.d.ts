import type { CSSProperties, HTMLAttributes } from 'react'

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
  paused?: boolean
  loading?: boolean
  loadingColor?: string
  onFrame?: (time: number) => void
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
  className?: string
  style?: CSSProperties
}

export default function LetterGlitch(props: LetterGlitchProps): React.JSX.Element
