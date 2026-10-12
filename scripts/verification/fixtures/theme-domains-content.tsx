/** Real feature surfaces and content adapters; data is isolated and deterministic. */
import * as React from 'react'
import { DndContext } from '@dnd-kit/core'
import { EntityRow } from '@/components/ui/entity-row'
import { KanbanColumn } from '@/components/app-shell/kanban/KanbanColumn'
import { DecisionBoard } from '@/components/content-panels/session-decisions/DecisionBoard'
import { PageFrame } from '@/components/pages/PageFrame'
import PdfPreview from '@/components/content-panels/PdfFilePreview'
import { useTheme } from '@/context/ThemeContext'
import { TrajectoryView } from '../../../packages/ui/src/components/trajectory/TrajectoryView'
import { EMPTY_TRAJECTORY_SNAPSHOT } from '../../../packages/ui/src/components/trajectory/trajectory-contract'
import { TerminalOutput } from '../../../packages/ui/src/components/terminal/TerminalOutput'
import { MarkdownMermaidBlock } from '../../../packages/ui/src/components/markdown/MarkdownMermaidBlock'
import { DECISION_LAYER_FEATURES } from '@phaneris/shared/decisions/settings'
import type { SessionDecisionReport } from '@phaneris/shared/decisions/session'
import type { LoadedPage } from '@phaneris/shared/pages/types'

function pdfBytes() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  const stream = 'BT /F1 18 Tf 30 150 Td (User-owned PDF) Tj ET'
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  let document = '%PDF-1.4\n', offsets = [0]
  objects.forEach((value, index) => { offsets.push(document.length); document += `${index + 1} 0 obj\n${value}\nendobj\n` })
  const start = document.length
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`
  return new TextEncoder().encode(document)
}
const bytes = pdfBytes()
const totals = { legacyCalls: 0, points: 1, requests: 1, changed: 0, fallback: 1, unconfirmed: 0, failures: 1, cancelled: 0,
  knownCostUsd: 0, knownCostRequests: 1, unknownCostRequests: 0, inputTokens: 20, outputTokens: 5 }
const report: SessionDecisionReport = { schemaVersion: 1, sessionId: 'roles', workspaceId: 'fixture', revision: 1, enabled: true, coverage: 'recorded',
  totals, features: [{ feature: DECISION_LAYER_FEATURES[0]!, totals }], items: [{ id: 'decision', feature: DECISION_LAYER_FEATURES[0]!, startedAt: 1, updatedAt: 2,
    attempts: [{ id: 'attempt', provider: 'fixture', model: 'gpt-4.1', sent: true, status: 'failed' }], unavailableReason: 'Offline fixture', observations: [] }], turnIds: [] }
const owned = '<!doctype html><html><head><style>body{background:#2c5364;color:#ffffff;font:16px sans-serif}</style></head><body>用户创作内容保留自身配色</body></html>'
const page: LoadedPage = { config: { schemaVersion: 1, id: 'page-fixture', slug: 'owned', name: '内容边界', kind: 'static', createdAt: 1, updatedAt: 1 },
  folderPath: 'E:/fixture/page', contentPath: 'E:/fixture/page/index.html', dataPath: 'E:/fixture/page/data', snapshotPath: 'E:/fixture/page/data/snapshot.json', workspaceRootPath: 'E:/fixture', workspaceId: 'fixture' }
const harness = { setState: (_state: 'ready' | 'empty' | 'loading' | 'error') => {}, clicks: 0, pdfErrors: [] as string[] }
declare global { interface Window { themeDomains: typeof harness } }
window.themeDomains = harness
export function ThemeDomainsContent() {
  const theme = useTheme(), [state, setState] = React.useState<'ready' | 'empty' | 'loading' | 'error'>('ready'), [selected, setSelected] = React.useState(false)
  React.useEffect(() => { harness.setState = setState }, [])
  const data: React.ComponentProps<typeof DecisionBoard>['data'] = { key: state, state: state === 'empty' ? 'ready' : state,
    report: state === 'ready' || state === 'empty' ? { ...report, items: state === 'empty' ? [] : report.items } : undefined, retry: () => setState('ready'), loadMore: () => {} }
  return <section data-domains-ready data-domain-state={state} className="space-y-4 min-w-0">
    <div data-testid="domain-list"><EntityRow title="中文长会话标题与知识库项目资料" subtitle="E:/项目资料/主题系统/审计与优化/说明.md" isSelected={selected}
      onClick={() => { setSelected(value => !value); harness.clicks++ }} buttonProps={{ 'data-testid': 'entity', role: 'option', tabIndex: 0, 'aria-selected': selected }} /></div>
    <div data-testid="domain-kanban" className="h-80 min-w-0"><DndContext><KanbanColumn column={{ id: 'todo', name: '主题治理' }}
      tasks={state === 'empty' ? [] : [{ id: 'theme-task', title: '中文任务与主题边界', column: 'todo', statusId: 'todo', subtasks: [], isProcessing: state === 'loading' }]}
      projectsById={new Map()} statusesById={new Map()} treatment="stripe" expandedTaskIds={new Set()} onTaskClick={() => { harness.clicks++ }} onEditTask={() => { harness.clicks++ }} /></DndContext></div>
    <div data-testid="domain-decision" className="h-[480px] min-w-0"><DecisionBoard sessionId="roles" workspaceId="fixture" data={data} onOpenChat={() => {}} onConfigure={() => {}} /></div>
    <div data-testid="domain-trajectory" className="h-[480px] min-w-0"><TrajectoryView snapshot={EMPTY_TRAJECTORY_SNAPSHOT} isProcessing={state === 'loading'}
      contextSummary={{ name: '主题治理 · 中文长路径', workingDirectory: 'E:/项目资料/主题系统/审计与优化', model: 'gpt-4.1' }} /></div>
    <div data-testid="domain-terminal"><TerminalOutput command="printf output" output={'Plain output\n\u001b[31mANSI red\u001b[0m'} theme={theme.isDark ? 'dark' : 'light'} exitCode={1} /></div>
    <div data-testid="domain-mermaid"><MarkdownMermaidBlock code="graph LR\n A[主题] --> B[快照] --> C[宿主]" /></div>
    <div data-testid="domain-pages" className="h-32"><PageFrame workspaceId="fixture" page={page} content={owned}
      lease={{ leaseId: 'fixture', nonce: 'fixture', pageSlug: 'owned', contentDigest: 'fixture', issuedAt: 1, expiresAt: 9999999999999 }} snapshot={null} /></div>
    <div data-testid="domain-pdf" className="h-80"><PdfPreview bytes={bytes} onError={error => harness.pdfErrors.push(error)} /></div>
  </section>
}
