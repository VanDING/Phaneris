import { bundledLanguages, codeToHtml, type BundledLanguage } from 'shiki'

const scope = self as unknown as {
  onmessage: (event: MessageEvent<{ id: number; code: string; language: string; theme: string }>) => void
  postMessage: (message: { id: number; html: string | null }) => void
}

scope.onmessage = async ({ data }) => {
  try {
    const html = await codeToHtml(data.code, {
      lang: data.language in bundledLanguages ? data.language as BundledLanguage : 'text',
      theme: data.theme,
    })
    scope.postMessage({ id: data.id, html })
  } catch {
    // Plain text remains visible if a language or theme cannot be loaded.
    scope.postMessage({ id: data.id, html: null })
  }
}
