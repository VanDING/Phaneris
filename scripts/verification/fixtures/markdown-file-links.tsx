import React from 'react'
import { createRoot } from 'react-dom/client'
import { Markdown, TooltipProvider } from '@phaneris/ui'
import '@/index.css'

declare global {
  interface Window {
    fileLinkFixture: { ready: boolean; files: string[]; urls: string[]; setContent: (content: string) => void }
  }
}

function Fixture() {
  const [content, setContent] = React.useState('[ready](https://example.com)')
  React.useEffect(() => {
    window.fileLinkFixture = { ready: true, files: [], urls: [], setContent }
  }, [])
  return <main className="p-8"><Markdown onFileClick={path => window.fileLinkFixture.files.push(path)} onUrlClick={url => window.fileLinkFixture.urls.push(url)}>{content}</Markdown></main>
}
createRoot(document.getElementById('root')!).render(<TooltipProvider><Fixture /></TooltipProvider>)
