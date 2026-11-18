import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { Provider } from 'jotai'
import { Button, TooltipProvider } from '@phaneris/ui'
import { ActionRegistryProvider } from '@/actions/registry'
import { AppShellProvider, type AppShellContextType } from '@/context/AppShellContext'
import { SkillsListPanel } from '@/components/app-shell/SkillsListPanel'
import { SourcesListPanel } from '@/components/app-shell/SourcesListPanel'
import { PluginsListPanel } from '@/components/app-shell/PluginsListPanel'
import { Info_Page } from '@/components/info/Info_Page'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { PluginAvatar } from '@/components/ui/plugin-avatar'
import { useWorkspaceResources } from '@/hooks/useWorkspaceResources'
import en from '../../../packages/shared/src/i18n/locales/en.json'

const workspaceId = 'resource-icons-fixture'
const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
function listen(channel: string, listener: (...args: unknown[]) => void) {
  const channelListeners = listeners.get(channel) ?? new Set()
  listeners.set(channel, channelListeners)
  channelListeners.add(listener)
  return () => { channelListeners.delete(listener) }
}
async function invoke<T>(channel: string, args: unknown[]): Promise<T> {
  const response = await fetch('/_resource_icons', { method: 'POST', body: JSON.stringify({ channel, args }) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error)
  for (const event of data.events) for (const listener of listeners.get(event.channel) ?? []) listener(...event.args)
  return data.value
}
Object.assign(window, { writeFixtureIcon: (type: string, shape: string) => invoke('fixture:writeIcon', [type, shape]) })

window.electronAPI = {
  getSources: id => invoke('sources:get', [id]),
  getSkills: id => invoke('skills:get', [id]),
  getPlugins: id => invoke('plugins:list', [id]),
  onSourcesChanged: listener => listen('sources:changed', listener as (...args: unknown[]) => void),
  onSkillsChanged: listener => listen('skills:changed', listener as (...args: unknown[]) => void),
  onPluginsChanged: listener => listen('plugins:changed', listener as (...args: unknown[]) => void),
  readWorkspaceImage: (id, path) => invoke('workspace:readImage', [id, path]),
} as typeof window.electronAPI

const i18n = createInstance()
await i18n.init({ lng: 'en', keySeparator: false, resources: { en: { translation: en } } })

function Fixture() {
  const [group, setGroup] = useState('Skills')
  const resources = useWorkspaceResources(workspaceId, undefined)
  const skill = resources.skills.items.find(item => item.slug === 'icon-check')
  const source = resources.sources.items.find(item => item.config.slug === 'icon-check')
  const plugin = resources.plugins.items.find(item => item.name === 'icon-check')
  const title = group === 'Skills' ? skill?.metadata.name : group === 'Sources' ? source?.config.name : plugin?.name
  const avatar = group === 'Skills' ? skill && <SkillAvatar skill={skill} workspaceId={workspaceId} fluid />
    : group === 'Sources' ? source && <SourceAvatar source={source} workspaceId={workspaceId} fluid />
      : plugin && <PluginAvatar plugin={plugin} workspaceId={workspaceId} fluid />

  return (
    <main className="bg-background text-foreground p-5">
      <nav className="flex gap-2 mb-5">{['Skills', 'Sources', 'Plugins'].map(name =>
        <Button key={name} variant={name === group ? 'secondary' : 'ghost'} onClick={() => setGroup(name)}>{name}</Button>)}</nav>
      <div className="flex flex-wrap gap-5">
        <section aria-label="Navigator" className="w-[260px] h-[320px] border border-border">
          {group === 'Skills' && skill && <SkillsListPanel skills={[skill]} workspaceId={workspaceId} selectedSkillSlug={skill.slug} onDeleteSkill={() => {}} onSkillClick={() => {}} />}
          {group === 'Sources' && source && <SourcesListPanel sources={[source]} selectedSourceSlug={source.config.slug} onDeleteSource={() => {}} onSourceClick={() => {}} />}
          {group === 'Plugins' && plugin && <PluginsListPanel plugins={[plugin]} selectedPluginName={plugin.name} workspaceId={workspaceId} />}
        </section>
        <section aria-label="Details" className="pt-5">
          {avatar && <Info_Page.Hero avatar={avatar} title={title} tagline="Resource details" resourceIcon />}
        </section>
      </div>
    </main>
  )
}

const context = { workspaces: [], activeWorkspaceId: workspaceId } as unknown as AppShellContextType
createRoot(document.getElementById('root')!).render(
  <I18nextProvider i18n={i18n}><Provider><TooltipProvider><ActionRegistryProvider><AppShellProvider value={context}>
    <Fixture />
  </AppShellProvider></ActionRegistryProvider></TooltipProvider></Provider></I18nextProvider>,
)
