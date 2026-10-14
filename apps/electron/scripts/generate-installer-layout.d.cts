type Box = [number, number, number, number]
type Font = { size: number; weight: number }
export interface InstallerLayout {
  window: { width: number; height: number; frameMargin: number }
  fonts: { latin: string; cjk: string; brand: Font; title: Font; body: Font; button: Font }
  brand: { image: Box; title: Box; markTop: number; markHeight: number }
  caption: { drag: Box; minimize: Box; close: Box; glyphSize: number }
  primary: { box: Box; diameter: number }
  welcome: { choose: Box; path: Box; pathInset: number; browse: Box; error: Box }
  finish: { title: Box; description: Box; launchY: number; launchHeight: number; launchExtraWidth: number }
  progress: { track: Box; status: Box; percent: Box; trackCorner: number }
}
export function generateInstallerLayout(): InstallerLayout
