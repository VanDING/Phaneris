import { app, BrowserWindow, screen } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { windowLog } from './logger'
import { defaultWindowBounds, fitWindowBounds } from './window-geometry'
import { loadWindowState } from './window-state'

/** One visible startup surface across backend bootstrap and renderer readiness.
 * Workspace windows prepare underneath; this sandbox never receives their data.
 */
export class StartupPresentation {
  readonly window: BrowserWindow
  private targets = new Set<BrowserWindow>()
  private readyTargets = new Set<BrowserWindow>()
  private primary: BrowserWindow | null = null
  private finished = false
  private revealing = false
  private loaded: Promise<void>

  constructor(title: string) {
    const saved = loadWindowState()?.windows[0]
    const bounds = saved?.bounds
    const valid = bounds && Object.values(bounds).every(Number.isFinite)
    const display = valid ? screen.getDisplayMatching(bounds) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const fitted = valid ? fitWindowBounds(bounds, display.workArea) : defaultWindowBounds(display.workArea)
    const icon = process.platform === 'win32' ? 'icon.ico' : process.platform === 'darwin' ? 'icon.icns' : 'icon.png'
    const iconPath = [join(__dirname, 'resources', icon), join(__dirname, '../resources', icon)].find(existsSync)
    this.window = new BrowserWindow({ ...fitted, show: false, title, backgroundColor: '#ffffff', icon: iconPath,
      minWidth: Math.min(800, display.workArea.width), minHeight: Math.min(600, display.workArea.height),
      ...(process.platform === 'darwin' && { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 16 } }),
      ...(process.platform === 'win32' && { titleBarStyle: 'hidden', titleBarOverlay: { color: '#ffffff', symbolColor: '#1a1625', height: 48 } }),
      autoHideMenuBar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
    this.window.setMenu(null)
    this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.window.webContents.on('will-navigate', event => event.preventDefault())
    this.window.once('ready-to-show', () => {
      if (this.finished) return
      if (saved?.maximized) this.window.maximize()
      this.window.show()
    })
    this.window.once('closed', () => {
      // Closing the only visible surface cancels startup, including backend work.
      if (!this.finished) app.quit()
    })
    this.window.webContents.once('render-process-gone', () => this.finish(true))
    this.loaded = process.env.VITE_DEV_SERVER_URL
      ? this.window.loadURL(new URL('startup.html', process.env.VITE_DEV_SERVER_URL).href)
      : this.window.loadFile(join(__dirname, 'renderer/startup.html'))
    void this.loaded.catch(error => {
      windowLog.error('Startup presentation could not load', error)
      this.finish(true)
    })
  }

  /** Called before a managed workspace's first paint. */
  attach(window: BrowserWindow, maximized: boolean): boolean {
    if (this.finished) return false
    this.targets.add(window)
    window.webContents.once('render-process-gone', () => this.fail(window))
    window.once('closed', () => {
      this.targets.delete(window)
      this.readyTargets.delete(window)
      if (window === this.primary) this.finish(true)
    })
    if (!this.primary) {
      this.primary = window
      this.window.setBounds(window.getBounds())
      if (maximized) this.window.maximize()
    }
    return true
  }

  /** A deep link or second instance must not expose an unready workspace. */
  focusPending(window: BrowserWindow): boolean {
    if (!this.targets.has(window)) return false
    const surface = this.finished ? this.primary : this.window
    if (surface && !surface.isDestroyed()) {
      if (surface.isMinimized()) surface.restore()
      surface.show()
      surface.focus()
    }
    return true
  }

  fail(window: BrowserWindow): void {
    if (!this.targets.has(window)) return
    if (!window.isDestroyed()) window.showInactive()
    this.targets.delete(window)
    this.readyTargets.delete(window)
    if (window === this.primary) this.finish(true)
  }

  manages(senderId: number): boolean {
    return !this.finished && [...this.targets].some(window => !window.isDestroyed() && window.webContents.id === senderId)
  }

  /** Only the owned primary renderer may declare its UI ready. */
  ready(senderId: number): boolean {
    const target = [...this.targets].find(window => !window.isDestroyed() && window.webContents.id === senderId)
    if (!target) return false
    // A slower restored window joins directly when ready, without a second logo.
    if (this.finished) {
      this.targets.delete(target)
      target.showInactive()
      return true
    }
    this.readyTargets.add(target)
    if (this.primary?.webContents.id !== senderId) return true
    if (!this.revealing) {
      this.revealing = true
      void this.reveal().catch(error => {
        windowLog.error('Startup animation failed; revealing application', error)
        this.finish(true)
      })
    }
    return true
  }

  private async reveal(): Promise<void> {
    await this.loaded
    if (this.finished) return
    if (this.window.isMinimized()) await new Promise<void>(resolve => this.window.once('restore', () => resolve()))
    if (this.finished) return
    await this.window.webContents.executeJavaScript('window.playStartupLogo()')
    if (this.finished) return
    if (this.window.isMinimized()) await new Promise<void>(resolve => this.window.once('restore', () => resolve()))
    if (this.finished) return
    const focused = this.window.isFocused()
    const bounds = this.window.getBounds()
    for (const target of this.targets) {
      if (target.isDestroyed() || !this.readyTargets.has(target)) continue
      if (target === this.primary) {
        if (!this.window.isMaximized() && target.isMaximized()) target.unmaximize()
        target.setBounds(bounds)
        if (this.window.isMaximized()) target.maximize()
      }
      target.showInactive()
    }
    this.window.moveTop()
    const start = performance.now()
    await new Promise<void>(resolve => {
      const timer = setInterval(() => {
        if (this.finished || this.window.isDestroyed()) { clearInterval(timer); resolve(); return }
        const progress = Math.min(1, (performance.now() - start) / 240)
        this.window.setOpacity(1 - progress * progress)
        if (progress === 1) { clearInterval(timer); resolve() }
      }, 16)
    })
    this.finish()
    if (focused && this.primary && !this.primary.isDestroyed()) this.primary.focus()
  }

  private finish(force = false): void {
    if (this.finished) return
    this.finished = true
    for (const target of this.targets) {
      if (!force && !this.readyTargets.has(target)) continue
      if (!target.isDestroyed()) target.showInactive()
      this.targets.delete(target)
    }
    this.readyTargets.clear()
    if (!this.window.isDestroyed()) this.window.destroy()
  }
}

export function createStartupWindow(title: string): StartupPresentation {
  return new StartupPresentation(title)
}
