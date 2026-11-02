import { createContext } from 'react'

/** Export surfaces need rich blocks ready even when outside the viewport. */
export const StaticMarkdownContext = createContext(false)
