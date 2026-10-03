/**
 * Dialog footer probe — mounts the app's real modal action rows for automated
 * measurement.
 *
 * WHY THIS EXISTS
 *   `ConfirmDialogHost` / `ResetConfirmationDialog` / `DeletePageDialog` /
 *   `CreateProjectDialog` / `SendResourceToWorkspaceDialog` all render their
 *   cancel/confirm pair through `<DialogFooter>`. Spacing between those buttons
 *   is a single `gap-2` on that primitive, so a `className` override on any of
 *   the five call sites can silently collapse the row into touching buttons at
 *   desktop widths (a `sm:` variant beats a bare `gap-*` from 40rem up). That is
 *   invisible to typecheck, lint and any DOM-less test: it only shows up as
 *   pixels in a laid-out browser.
 *
 * HOW IT IS USED
 *   `scripts/verification/dialog-footer-spacing.mjs` serves the renderer dev
 *   server, imports this module over HTTP and drives `window.__dialogFooterProbe`
 *   to mount one dialog at a time, then measures the real geometry of the footer
 *   buttons. The delete-session scenario replays the exact payload the main
 *   process relays for `auth:showDeleteSessionConfirmation`, so the measured
 *   dialog is the one the user reported.
 *
 *   Nothing in the app imports this module: it is reachable only through the dev
 *   server, and no production entry pulls it in.
 */

import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Provider as JotaiProvider } from 'jotai'
import { changeAppLanguage } from '@phaneris/shared/i18n'
import { ThemeProvider } from '@/context/ThemeContext'
import { ModalProvider } from '@/context/ModalContext'
import { ConfirmDialogHost } from '@/components/ConfirmDialogHost'
import { ResetConfirmationDialog } from '@/components/ResetConfirmationDialog'
import { CreateProjectDialog } from '@/components/projects/CreateProjectDialog'
import { DeletePageDialog } from '@/components/pages/DeletePageDialog'
import { SendResourceToWorkspaceDialog } from '@/components/app-shell/SendResourceToWorkspaceDialog'
import type { ConfirmDialogRequestPayload } from '../../../shared/confirm-dialog'
import type { Workspace } from '../../../shared/types'

/** Scenario ids the verification script mounts, in order. */
export const PROBE_SCENARIOS = [
  'delete-session',
  'logout',
  'delete-page',
  'reset-confirmation',
  'create-project',
  'send-resource',
] as const

export type ProbeScenario = (typeof PROBE_SCENARIOS)[number]

/**
 * Server-requested confirmations, mirroring the specs the server sends for
 * `auth:showDeleteSessionConfirmation` / `auth:showLogoutConfirmation`
 * (`packages/server-core/src/handlers/rpc/auth.ts`). The main process relays the
 * same object to `ConfirmDialogHost`, so replaying it here exercises the real
 * renderer path rather than a hand-built dialog.
 */
const SERVER_CONFIRM_SPECS: Partial<Record<ProbeScenario, ConfirmDialogRequestPayload['spec']>> = {
  'delete-session': {
    type: 'warning',
    buttons: ['Cancel', 'Delete'],
    defaultId: 0,
    cancelId: 0,
    title: 'Delete Conversation',
    message: 'Are you sure you want to delete: "日常问候"?',
    detail: 'This action cannot be undone.',
    i18n: {
      titleKey: 'dialog.deleteSession.title',
      messageKey: 'dialog.deleteSessionConfirmation',
      detailKey: 'dialog.deleteSession.detail',
      confirmKey: 'common.delete',
      cancelKey: 'common.cancel',
      values: { name: '日常问候' },
    },
  },
  logout: {
    type: 'warning',
    buttons: ['Cancel', 'Log Out'],
    defaultId: 0,
    cancelId: 0,
    title: 'Log Out',
    message: 'Are you sure you want to log out?',
    detail: 'All conversations will be deleted. This action cannot be undone.',
    i18n: {
      titleKey: 'dialog.logout.title',
      messageKey: 'dialog.logoutConfirmation',
      detailKey: 'dialog.logout.detail',
      confirmKey: 'dialog.logout.confirm',
      cancelKey: 'common.cancel',
    },
  },
}

const PROBE_WORKSPACE: Workspace = {
  id: 'probe-workspace',
  name: 'Probe Workspace',
  slug: 'probe-workspace',
  rootPath: '/probe/workspace',
  createdAt: 1,
}

/** Buttons the probe renders per scenario: how many, and in what order. */
const SCENARIO_BUTTONS: Record<ProbeScenario, number> = {
  'delete-session': 2,
  logout: 2,
  'delete-page': 2,
  'reset-confirmation': 2,
  'create-project': 2,
  'send-resource': 2,
}

interface ProbeHandle {
  scenarios: readonly ProbeScenario[]
  /** Dialog content selectors, so the script does not guess at Radix internals. */
  contentSelector: string
  footerSelector: string
  buttonCount: Record<ProbeScenario, number>
  responses: Array<{ id: string; response: number }>
  mount: (scenario: ProbeScenario, options?: { language?: string }) => Promise<void>
  unmount: () => Promise<void>
}

declare global {
  interface Window {
    __dialogFooterProbe?: ProbeHandle
  }
}

/** Answers captured from the host, so a click can be asserted end to end. */
const responses: ProbeHandle['responses'] = []

/**
 * Captures the listener `ConfirmDialogHost` subscribes with. The playground's
 * mock `electronAPI` does not implement the confirm bridge (real preload does),
 * so the probe installs it and can then deliver a request like the main process.
 */
let deliverRequest: ((payload: ConfirmDialogRequestPayload) => void) | null = null

function installConfirmBridge(): void {
  const api = window.electronAPI
  if (!api) {
    throw new Error('probe: window.electronAPI is missing — the playground mock never installed')
  }
  api.onConfirmDialogRequest = (callback) => {
    deliverRequest = callback
    return () => {
      deliverRequest = null
    }
  }
  api.respondConfirmDialog = async (id, response) => {
    responses.push({ id, response })
    return { ok: true }
  }
}

let container: HTMLDivElement | null = null
let root: Root | null = null

/** One element per scenario; `Record` over the union keeps the map exhaustive. */
const SCENARIO_ELEMENTS: Record<ProbeScenario, () => React.ReactElement> = {
  'delete-session': () => <ConfirmDialogHost />,
  logout: () => <ConfirmDialogHost />,
  'delete-page': () => (
    <DeletePageDialog pageName="Release dashboard" shared onConfirm={() => {}} onCancel={() => {}} />
  ),
  'reset-confirmation': () => (
    <ResetConfirmationDialog open onConfirm={() => {}} onCancel={() => {}} />
  ),
  'create-project': () => <CreateProjectDialog open onCancel={() => {}} onSubmit={() => {}} />,
  'send-resource': () => (
    <SendResourceToWorkspaceDialog
      open
      onOpenChange={() => {}}
      resourceType="skill"
      resourceIds={['probe-skill']}
      resourceLabel="Probe Skill"
      workspaces={[PROBE_WORKSPACE]}
      activeWorkspaceId="probe-active-workspace"
    />
  ),
}

/** Resolves after the browser has painted the current React commit. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

async function waitForDialog(): Promise<void> {
  const deadline = Date.now() + 5000
  for (;;) {
    if (document.querySelector('[data-slot="dialog-content"]')) return
    if (Date.now() > deadline) {
      throw new Error('probe: no [data-slot="dialog-content"] appeared within 5s')
    }
    await nextPaint()
  }
}

const handle: ProbeHandle = {
  scenarios: PROBE_SCENARIOS,
  contentSelector: '[data-slot="dialog-content"]',
  footerSelector: '[data-slot="dialog-footer"]',
  buttonCount: SCENARIO_BUTTONS,
  responses,

  async mount(scenario, options) {
    if (!PROBE_SCENARIOS.includes(scenario)) {
      throw new Error(`probe: unknown scenario "${scenario}"`)
    }
    await changeAppLanguage(options?.language ?? 'zh-Hans')
    // Answers belong to one mount: a stale index must never satisfy a later click.
    responses.length = 0

    container = document.createElement('div')
    container.dataset.probeRoot = scenario
    document.body.appendChild(container)
    root = createRoot(container)
    root.render(
      <JotaiProvider>
        <ThemeProvider>
          <ModalProvider>{SCENARIO_ELEMENTS[scenario]()}</ModalProvider>
        </ThemeProvider>
      </JotaiProvider>,
    )

    const spec = SERVER_CONFIRM_SPECS[scenario]
    if (spec) {
      // The host subscribes in an effect; give React a commit to run it.
      await nextPaint()
      if (!deliverRequest) throw new Error('probe: ConfirmDialogHost never subscribed to the bridge')
      deliverRequest({ id: `probe-${scenario}`, spec })
    }

    await waitForDialog()
    await nextPaint()
  },

  async unmount() {
    root?.unmount()
    root = null
    container?.remove()
    container = null
    await nextPaint()
  },
}

installConfirmBridge()
window.__dialogFooterProbe = handle
