import { BrowserWindow } from 'electron'
import { DEFAULT_THEME_FILE, getBackgroundColor, themeToCSS } from '@phaneris/shared/config/theme'
import { windowLog } from './logger'

/** A loading surface only: no preload, Node, RPC or workspace data. */
export function createStartupWindow(title: string, label: string, dark: boolean): BrowserWindow {
  const window = new BrowserWindow({ width: 360, height: 160, show: false, frame: false, resizable: false,
    title, backgroundColor: getBackgroundColor(dark),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
    <title>${escape(title)}</title><style>:root { ${themeToCSS(DEFAULT_THEME_FILE, dark)} }
    body { margin:0; height:100vh; display:grid; place-content:center; gap:12px; text-align:center;
      background:var(--background); color:var(--foreground); font:menu; user-select:none; -webkit-app-region:drag; }
    h1 { margin:0; font:inherit; font-weight:600; } p { margin:0; color:var(--foreground-dimmed); }</style>
    <body data-startup><h1>${escape(title)}</h1><p role="status">${escape(label)}</p></body>`
  const reveal = setTimeout(() => { if (!window.isDestroyed()) window.show() }, 350)
  window.once('closed', () => clearTimeout(reveal))
  window.setMenu(null)
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    .catch(error => windowLog.error('Startup feedback could not load', error))
  return window
}
