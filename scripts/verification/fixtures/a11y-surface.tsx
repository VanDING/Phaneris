/**
 * Accessibility audit surface.
 *
 * One page that puts the product's core interaction primitives in front of
 * axe-core: the session search field, the button/input/select family, an
 * icon-only action, a status chip, a Radix dialog with a form, and a Radix
 * dropdown menu. The workflow audits the base page, the open dialog and the
 * open menu separately, because most violations live in portal content that
 * does not exist until the surface opens.
 *
 * Everything here is the shipped component; only the surrounding page and the
 * copy are synthetic.
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { Settings, Sparkles } from 'lucide-react'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import { SessionSearchHeader } from '@/components/app-shell/SessionSearchHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuTrigger, StyledDropdownMenuContent, StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'

const i18n = createInstance()
await i18n.init({ lng: 'en', keySeparator: false, resources: { en: { translation: en } } })

const stylesheet = new URLSearchParams(location.search).get('css')
if (!stylesheet) throw new Error('a11y surface requires ?css=<host stylesheet>')
const link = document.createElement('link')
link.rel = 'stylesheet'
link.href = stylesheet
document.head.append(link)

function Surface() {
  const [query, setQuery] = React.useState('')
  return (
    <div data-a11y-surface className="min-h-screen bg-background text-foreground">
      <main className="mx-auto w-[520px] space-y-4 pt-6">
        <h1 className="text-title font-semibold">Accessibility surface</h1>

        <SessionSearchHeader
          searchQuery={query}
          onSearchChange={setQuery}
          onSearchClose={() => setQuery('')}
          resultCount={4}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button>Primary action</Button>
          <Button variant="outline">Secondary</Button>
          <Button variant="ghost" size="icon" aria-label="Sparkle">
            <Sparkles className="size-4" />
          </Button>
        </div>

        <label className="block space-y-1">
          <span className="text-label">Workspace name</span>
          <Input placeholder="my-workspace" />
        </label>

        <div className="flex items-center gap-2">
          <span className="rounded-shape-sm bg-success/10 px-2 py-0.5 text-meta text-success-text">Done</span>
          <span className="rounded-shape-sm bg-info/10 px-2 py-0.5 text-meta text-info-text">Running</span>
        </div>

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename workspace</DialogTitle>
              <DialogDescription>Pick a name other people will recognise.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <label className="block space-y-1">
                <span className="text-label">Name</span>
                <Input defaultValue="fleet-whale" />
              </label>
              <label className="block space-y-1">
                <span className="text-label">Description</span>
                <Input placeholder="Optional" />
              </label>
            </div>
            <DialogFooter>
              <Button variant="ghost">Cancel</Button>
              <Button>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Settings className="size-4" /> More actions
            </Button>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent>
            <StyledDropdownMenuItem>Duplicate</StyledDropdownMenuItem>
            <StyledDropdownMenuItem>Archive</StyledDropdownMenuItem>
            <StyledDropdownMenuItem disabled>Delete</StyledDropdownMenuItem>
          </StyledDropdownMenuContent>
        </DropdownMenu>
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <I18nextProvider i18n={i18n}>
    <Surface />
  </I18nextProvider>,
)

declare global {
  interface Window {
    a11ySurface: { ready: true }
  }
}
window.a11ySurface = { ready: true }
