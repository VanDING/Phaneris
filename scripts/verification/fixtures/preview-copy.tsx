import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import { HTMLPreviewOverlay } from '../../../packages/ui/src/components/overlay/HTMLPreviewOverlay'
import { PDFPreviewOverlay } from '../../../packages/ui/src/components/overlay/PDFPreviewOverlay'
import { ImagePreviewOverlay } from '../../../packages/ui/src/components/overlay/ImagePreviewOverlay'
import { MermaidPreviewOverlay } from '../../../packages/ui/src/components/overlay/MermaidPreviewOverlay'
import { CopyButton } from '../../../packages/ui/src/components/overlay/CopyButton'
import { TooltipProvider } from '@phaneris/ui'
import '../../../apps/electron/src/renderer/index.css'

declare global { interface Window { previewCopies: string[]; previewCopyExpected: Record<string, { title: string; content: string }> } }
window.previewCopies = []
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { window.previewCopies.push(text) } } })
const i18n = createInstance(); await i18n.init({ lng: 'en', keySeparator: false, resources: { en: { translation: en } } })
const html = '<!doctype html><html><body><p>Architecture HTML copy fixture</p></body></html>', code = 'graph TD; A-->B'
window.previewCopyExpected = {
  html: { title: en['common.copy'], content: html }, pdf: { title: en['common.copyPath'], content: '/fixture/copy.pdf' },
  image: { title: en['common.copyPath'], content: '/fixture/copy.png' }, mermaid: { title: en['common.copyCode'], content: code },
  legacy: { title: en['common.copy'], content: 'Retain legacy label typing' },
}
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="100"><rect width="240" height="100" fill="#4682b4"/></svg>'
const loadImage = async () => 'data:image/svg+xml,' + encodeURIComponent(svg)
const loadPdf = async () => {
  const stream = 'BT /F1 14 Tf 20 50 Td (Architecture copy fixture) Tj ET'
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]
  let content = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((object, index) => { offsets.push(content.length); content += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = content.length
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  return new TextEncoder().encode(content + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
}
function Fixture() {
  const [open, setOpen] = React.useState(''), close = () => setOpen('')
  return <><main>{Object.keys(window.previewCopyExpected).filter(id => id !== 'legacy').map(id => <button key={id} data-testid={'open-' + id} onClick={() => setOpen(id)}>{id}</button>)}
    <div data-testid="legacy"><CopyButton content={window.previewCopyExpected.legacy!.content} label="Legacy unused label remains accepted" /></div></main>
    <HTMLPreviewOverlay isOpen={open === 'html'} onClose={close} html={html} />
    <PDFPreviewOverlay isOpen={open === 'pdf'} onClose={close} filePath="/fixture/copy.pdf" loadPdfData={loadPdf} />
    <ImagePreviewOverlay isOpen={open === 'image'} onClose={close} filePath="/fixture/copy.png" loadDataUrl={loadImage} />
    <MermaidPreviewOverlay isOpen={open === 'mermaid'} onClose={close} svg={svg} code={code} />
  </>
}
createRoot(document.getElementById('root')!).render(<I18nextProvider i18n={i18n}><TooltipProvider><Fixture /></TooltipProvider></I18nextProvider>)
