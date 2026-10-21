import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { TooltipProvider } from '@phaneris/ui'
import { CompactionThresholdSetting } from '@/components/settings/CompactionThresholdSetting'
import { TrajectoryOverview } from '../../../packages/ui/src/components/trajectory/TrajectoryOverview'
import { EMPTY_TRAJECTORY_SNAPSHOT } from '../../../packages/ui/src/components/trajectory/trajectory-contract'
import type { TrajectoryContextSummary } from '../../../packages/ui/src/components/trajectory/TrajectoryView'
import type { ElectronAPI } from '../../../apps/electron/src/shared/types'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import zh from '../../../packages/shared/src/i18n/locales/zh-Hans.json'
import '@/index.css'

declare global {
  interface Window {
    followupRpc(method: 'get' | 'set', value?: unknown): Promise<unknown>
    followupFixture: {
      ready: boolean; remount(): void; language(value: string): Promise<unknown>
      show(value: Record<string, TrajectoryContextSummary>): void
    }
  }
}
const i18n = createInstance()
void i18n.init({ lng: 'en', fallbackLng: 'en', initAsync: false, resources: { en: { translation: en }, 'zh-Hans': { translation: zh } }, interpolation: { escapeValue: false } })
window.electronAPI = {
  getCompactionThreshold: () => window.followupRpc('get') as Promise<number | null>,
  setCompactionThreshold: value => window.followupRpc('set', value) as Promise<void>,
} as ElectronAPI

function App() {
  const [revision, setRevision] = React.useState(0)
  const [projections, setProjections] = React.useState<Record<string, TrajectoryContextSummary>>({})
  React.useEffect(() => {
    window.followupFixture = { ready: true, remount: () => setRevision(value => value + 1),
      language: value => i18n.changeLanguage(value), show: setProjections }
  }, [])
  return <main className="mx-auto max-w-3xl space-y-6 p-6">
    <section data-testid="threshold-setting"><CompactionThresholdSetting key={revision} /></section>
    <button type="button" data-testid="blur-target">Move focus</button>
    {Object.entries(projections).map(([key, contextSummary]) => <section key={key} data-testid={`metering-${key}`}>
      <TrajectoryOverview onOpenTrajectory={() => {}} onOpenContext={() => {}} snapshot={EMPTY_TRAJECTORY_SNAPSHOT} turns={[]} records={[]} contextSummary={contextSummary} />
    </section>)}
  </main>
}
createRoot(document.getElementById('root')!).render(<I18nextProvider i18n={i18n}><TooltipProvider><App /></TooltipProvider></I18nextProvider>)
