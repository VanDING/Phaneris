import React from 'react'
import { createRoot } from 'react-dom/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { TooltipProvider } from '@phaneris/ui'
import { DocsOverlay } from '@/components/docs/DocsOverlay'
import { openDocs } from '@/atoms/docs'
import { DOCS_PAGES } from '@/docs/manifest'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import zh from '../../../packages/shared/src/i18n/locales/zh-Hans.json'
import '@/index.css'
const i18n = createInstance(); await i18n.init({ lng: 'zh-Hans', keySeparator: false, resources: { en: { translation: en }, 'zh-Hans': { translation: zh } } })
Object.assign(window, { electronAPI: { openUrl: async () => {}, getRuntimeEnvironment: () => 'web' }, docsFixture: { open: openDocs, pages: DOCS_PAGES, language: (lng: string) => i18n.changeLanguage(lng) } })
openDocs()
createRoot(document.getElementById('root')!).render(<I18nextProvider i18n={i18n}><TooltipProvider><DocsOverlay /></TooltipProvider></I18nextProvider>)
