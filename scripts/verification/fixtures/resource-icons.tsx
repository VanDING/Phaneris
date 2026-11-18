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
import { ResourceIconEditor } from '@/components/ui/resource-icon-editor'
import { skillIconKey } from '@/lib/resource-icons'
import type { LoadedSkill, LoadedSource, PluginSummary } from '../../../apps/electron/src/shared/types'
import type { ResourceIcon, ResourceIcons } from '@phaneris/shared/resources/icons'
import en from '../../../packages/shared/src/i18n/locales/en.json'

const workspaceId = 'resource-icons-fixture'
const skill: LoadedSkill = { slug: 'test', source: 'workspace', path: '/workspace/skills/test',
  metadata: { name: 'Document writer', description: 'Write documents' }, content: 'A skill' }
const source = { config: { slug: 'test', name: 'Project files', type: 'local', enabled: true },
  folderPath: '/workspace/sources/test', workspaceRootPath: '/workspace', workspaceId: 'workspace', guide: null } as LoadedSource
const plugin: PluginSummary = { name: 'Document tools', description: 'A bundle', path: '/workspace/plugins/test',
  workspaceRelativePath: 'plugins/test', skills: [], sources: [], hasPromptFragment: false, warnings: [] }

type Listener = Parameters<Window['electronAPI']['onResourceIconChanged']>[0]
const listeners = new Set<Listener>()
async function invoke<T>(channel: string, args: unknown[]): Promise<T> {
  const response = await fetch('/_resource_icons', { method: 'POST', body: JSON.stringify({ channel, args }) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error)
  for (const event of data.events as Parameters<Listener>[]) for (const listener of listeners) listener(...event)
  return data.value
}

window.electronAPI = {
  getResourceIcons: id => invoke<ResourceIcons>('resources:getIcons', [id]),
  setResourceIcon: (id, key, icon) => invoke<void>('resources:setIcon', [id, key, icon]),
  onResourceIconChanged: listener => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  readWorkspaceImage: async (_id, path) => path === 'plugins/Document tools/icon.svg'
    ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/></svg>'
    : null,
} as typeof window.electronAPI

const i18n = createInstance()
await i18n.init({ lng: 'en', keySeparator: false, resources: { en: { translation: en } } })

function Fixture() {
  const [group, setGroup] = useState('Skills')
  const iconKey = group === 'Skills' ? skillIconKey(skill) : group === 'Sources' ? 'source:test' : 'plugin:Document tools'
  const title = group === 'Skills' ? skill.metadata.name : group === 'Sources' ? source.config.name : plugin.name
  const avatar = (icon?: ResourceIcon | null) => group === 'Skills' ? <SkillAvatar skill={skill} workspaceId={workspaceId} fluid iconOverride={icon} />
    : group === 'Sources' ? <SourceAvatar source={source} workspaceId={workspaceId} fluid iconOverride={icon} />
      : <PluginAvatar plugin={plugin} workspaceId={workspaceId} fluid iconOverride={icon} />

  return (
    <main className="bg-background text-foreground p-5">
      <nav className="flex gap-2 mb-5">{['Skills', 'Sources', 'Plugins'].map(name =>
        <Button key={name} variant={name === group ? 'secondary' : 'ghost'} onClick={() => setGroup(name)}>{name}</Button>)}</nav>
      <div className="flex flex-wrap gap-5">
        <section aria-label="Navigator" className="w-[260px] h-[320px] border border-border">
          {group === 'Skills' && <SkillsListPanel skills={[skill]} workspaceId={workspaceId} selectedSkillSlug={skill.slug} onDeleteSkill={() => {}} onSkillClick={() => {}} />}
          {group === 'Sources' && <SourcesListPanel sources={[source]} selectedSourceSlug={source.config.slug} onDeleteSource={() => {}} onSourceClick={() => {}} />}
          {group === 'Plugins' && <PluginsListPanel plugins={[plugin]} selectedPluginName={plugin.name} workspaceId={workspaceId} />}
        </section>
        <section aria-label="Details" className="pt-5">
          <Info_Page.Hero avatar={avatar()} title={title} tagline="Resource details"
            resourceIconAction={<ResourceIconEditor key={iconKey} workspaceId={workspaceId} iconKey={iconKey} renderIcon={avatar} />} />
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
