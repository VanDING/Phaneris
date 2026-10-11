import type { Page } from 'playwright'
export function verifyConversation(page: Page, fixture: { name: string; session: string; filePath: string; planPath: string }, output: string, host: string): Promise<string[]>
export function changeLanguageAndReturn(page: Page, label: string, sessionName: string): Promise<void>
