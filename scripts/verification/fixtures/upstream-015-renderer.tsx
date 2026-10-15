/** Existing production form/composer, without a provider or a live account. */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { Toaster } from 'sonner'
import { Provider } from 'jotai'
import { TooltipProvider } from '@phaneris/ui'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import { AuthRequestCard } from '../../../apps/electron/src/renderer/components/chat/AuthRequestCard'
import { FreeFormInput } from '../../../apps/electron/src/renderer/components/app-shell/input/FreeFormInput'
import { EscapeInterruptProvider } from '../../../apps/electron/src/renderer/context/EscapeInterruptContext'
import { AppShellProvider, type AppShellContextType } from '../../../apps/electron/src/renderer/context/AppShellContext'
import type { Message, FileAttachment } from '../../../apps/electron/src/shared/types'

const responses: unknown[] = [], submitted: unknown[] = []
let current = { draft:'Retained draft', attachments:[] as FileAttachment[] }
const api = { responses, submitted, state: () => current, seed: (_files: FileAttachment[]) => {} }
const unexpectedHostAction = (): never => { throw new Error('Unexpected host action in composer verification') }
const hostContext: AppShellContextType = {
  workspaces:[],activeWorkspaceId:null,activeWorkspaceSlug:null,llmConnections:[],sessionOptions:new Map(),
  pendingPermissions:new Map(),pendingCredentials:new Map(),pendingQuestions:new Map(),refreshLlmConnections:async()=>{},
  getDraft:()=>'',getDraftAttachmentRefs:()=>[],hydrateDraftAttachments:async()=>[],
  onCreateSession:async()=>unexpectedHostAction(),onDeleteSession:async()=>unexpectedHostAction(),
  onSendMessage:unexpectedHostAction,onRenameSession:unexpectedHostAction,onFlagSession:unexpectedHostAction,onUnflagSession:unexpectedHostAction,
  onArchiveSession:unexpectedHostAction,onUnarchiveSession:unexpectedHostAction,onMarkSessionRead:unexpectedHostAction,onMarkSessionUnread:unexpectedHostAction,
  onSetActiveViewingSession:unexpectedHostAction,onSessionStatusChange:unexpectedHostAction,onOpenFile:unexpectedHostAction,onOpenUrl:unexpectedHostAction,
  onSelectWorkspace:unexpectedHostAction,onOpenSettings:unexpectedHostAction,onOpenKeyboardShortcuts:unexpectedHostAction,
  onOpenStoredUserPreferences:unexpectedHostAction,onReset:unexpectedHostAction,onSessionOptionsChange:unexpectedHostAction,
  onInputChange:unexpectedHostAction,onAttachmentsChange:unexpectedHostAction,
}
Object.assign(window, { upstream015: api })
void i18n.use(initReactI18next).init({ lng:'en', fallbackLng:'en', resources:{ en:{ translation:en } }, keySeparator:false, interpolation:{escapeValue:false} }).then(() => {
  function Fixture() {
    const [draft,setDraft] = React.useState('Retained draft'), [attachments,setAttachments] = React.useState<FileAttachment[]>([])
    api.seed = files => setAttachments(files)
    current = {draft,attachments}
    return <Provider><AppShellProvider value={hostContext}><TooltipProvider><EscapeInterruptProvider><Toaster />
      <section id="credentials"><AuthRequestCard sessionId="fixture" message={{id:'auth',role:'auth-request',content:'',timestamp:1,
        authRequestId:'auth',authRequestType:'credential',authSourceSlug:'fixture',authSourceName:'Fixture',authCredentialMode:'bearer',authStatus:'pending'} as Message}
        onRespondToCredential={(_session,_id,response) => responses.push(response)} /></section>
      <section id="composer"><FreeFormInput currentModel="pi/fixture" onModelChange={() => {}} inputValue={draft} onInputChange={setDraft}
        attachmentsValue={attachments} onAttachmentsChange={setAttachments}
        onSubmit={(text,files) => submitted.push({text,files})} /></section>
    </EscapeInterruptProvider></TooltipProvider></AppShellProvider></Provider>
  }
  createRoot(document.getElementById('root')!).render(<Fixture />)
})
