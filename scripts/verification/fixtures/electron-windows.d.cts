import type { ElectronApplication, Page } from 'playwright'
export function firstBusinessWindow(application: ElectronApplication, options?: { timeout?: number }): Promise<Page>
