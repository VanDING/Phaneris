// Real production components, with an in-memory IPC boundary: no credentials,
// user data, provider calls, or paid model execution are used by this fixture.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { initReactI18next } from 'react-i18next'
import { setupI18n } from '../../packages/shared/src/i18n'
import { TaskEditor } from '../../apps/electron/src/renderer/components/app-shell/kanban/TaskEditor'
import { ModelChip } from '../../apps/electron/src/renderer/components/app-shell/kanban/ModelChip'
import { ModalProvider } from '../../apps/electron/src/renderer/context/ModalContext'
import { providerIcons } from '../../apps/electron/src/renderer/lib/provider-icons'
import { buildModelCatalog } from '../../apps/electron/src/renderer/components/app-shell/kanban/model-catalog'
import '../../apps/electron/src/renderer/index.css'

setupI18n([initReactI18next])
const calls: unknown[] = []
Object.assign(window, { verificationCalls: calls, expectedIcons: [providerIcons.minimax, providerIcons.deepseek, providerIcons.openai] })
let generated: ((workspaceId: string, event: unknown) => void) | undefined
const api = {
  getProjects: async () => [], listStatuses: async () => [], listWorkItems: async () => [],
  getHomeDir: async () => 'E:/fixture', getGitBranch: async () => null,
  isRemote: async () => false,
  onTaskGenerated: (callback: typeof generated) => { generated = callback; return () => { generated = undefined } },
  generateTask: async (_workspace: string, input: Record<string, unknown>) => {
    calls.push({ action: 'generate', input })
    setTimeout(() => generated?.('fixture', {
      orchestratorSessionId: 'draft', validation: { valid: true, errors: [] },
      spec: { title: 'Verified task', goal: 'Verify routing', nodes: [{ id: 'check', title: 'Check', prompt: 'Check routing' }] },
    }), 100)
    return { orchestratorSessionId: 'draft' }
  },
  createTask: async (_workspace: string, input: Record<string, unknown>) => {
    calls.push({ action: 'create', input })
    return { slug: 'verified-task', orchestratorSessionId: 'draft', validation: { valid: true, errors: [] } }
  },
  runTask: async () => { calls.push({ action: 'run' }); return { runId: 'fixture-run', nodes: ['check'] } },
  deleteSession: async () => true,
}
window.electronAPI = new Proxy(api, {
  get(target, prop: string) {
    if (prop in target) return target[prop as keyof typeof target]
    if (prop.startsWith('on')) return () => () => {}
    return async () => null
  },
}) as unknown as typeof window.electronAPI

const connected = [{
  slug: 'minimax', name: 'MiniMax', providerType: 'pi' as const, authType: 'api_key' as const,
  models: ['pi/MiniMax-M2', 'pi/MiniMax-M3'], defaultModel: 'pi/MiniMax-M3',
  isAuthenticated: true, isDefault: true, createdAt: 0,
}]
function Fixture() {
  const [connections, setConnections] = React.useState(new URLSearchParams(location.search).has('empty') ? [] : connected)
  const catalog = buildModelCatalog(connections)
  return <>
    <div data-testid="chips" className="flex gap-4 p-4">
      <ModelChip model="pi/MiniMax-M3" /><ModelChip model="pi/deepseek-flash" />
      <ModelChip model="pi/gpt-5" /><ModelChip model="pi/private-model" />
      <button onClick={() => setConnections(connected)}>Load connections</button>
    </div>
    <TaskEditor workspaceId="fixture" target={{ mode: 'create' }}
      onClose={() => {}} modelGroups={catalog.groups} modelToConnection={catalog.modelToConnection}
      defaultModel={catalog.defaultModel ?? ''} />
  </>
}
createRoot(document.getElementById('root')!).render(<ModalProvider><Fixture /></ModalProvider>)
