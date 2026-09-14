import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, LocateFixed, Maximize2, Minus, Plus, PanelRight, X } from 'lucide-react'
import type { TrajectorySnapshot } from './trajectory-contract'
import { trajectoryRecordId, type TrajectoryTurnModel } from './trajectory-layout'
import type { TrajectorySessionMap } from './trajectory-session-map'
import { buildExecutionGraph, groupExecutionByBehavior, defaultBehaviorCollapsed, layoutBehaviorGraph, type ExecutionNode, type ExecutionMapNode } from './trajectory-execution-map'
import { resizeMapViewport, type MapViewportTransform } from './trajectory-map-viewport'
import styles from './TrajectoryMapView.module.css'

export interface TrajectoryMapViewProps {
  snapshot: TrajectorySnapshot
  turns: readonly TrajectoryTurnModel[]
  sessionMap: TrajectorySessionMap
  isProcessing?: boolean
  isActive?: boolean
  onSelectRecord?: (index: number) => void
  onOpenSession?: (sessionId: string) => void
}

const clampScale = (scale: number) => Math.min(1.6, Math.max(0.05, scale))
const duration = (ms: number | null) => ms === null ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${(ms / 60000).toFixed(1)} min`

export function TrajectoryMapView({ snapshot, turns, sessionMap, isProcessing = false, isActive = true, onSelectRecord, onOpenSession }: TrajectoryMapViewProps) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const inspectorCloseRef = useRef<HTMLButtonElement>(null)
  const inspectorTriggerRef = useRef<HTMLElement | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [isCompact, setIsCompact] = useState(true)
  const [animateViewport, setAnimateViewport] = useState(false)
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [weight, setWeight] = useState<'duration' | 'tokens'>('duration')
  const [turnFilter, setTurnFilter] = useState('all')
  const [transform, setTransform] = useState<MapViewportTransform>({ x: 28, y: 28, scale: 0.9 })
  const fittedRef = useRef(false)
  const pendingFocusRef = useRef<string | null>(null)
  const lastViewportSizeRef = useRef({ width: 0, height: 0 })
  const dragRef = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null)
  const sourceGraph = useMemo(() => buildExecutionGraph(snapshot, sessionMap, isProcessing), [snapshot, sessionMap, isProcessing])
  const graph = useMemo(() => groupExecutionByBehavior(sourceGraph, turnFilter === 'all' ? null : Number(turnFilter)), [sourceGraph, turnFilter])
  const collapsed = useMemo(() => {
    const next = defaultBehaviorCollapsed(graph)
    for (const [id, value] of overrides) { if (value) next.add(id); else next.delete(id) }
    return next
  }, [graph, overrides])
  const layout = useMemo(() => layoutBehaviorGraph(graph, collapsed, selectedId), [graph, collapsed, selectedId])
  const allNodes = useMemo(() => new Map(graph.nodes.map(node => [node.id, node])), [graph])
  const nodes = useMemo(() => new Map(layout.nodes.map(node => [node.id, node])), [layout])
  const visibleNode = (id: string): ExecutionMapNode | undefined => {
    let node = allNodes.get(id)
    while (node && !nodes.has(node.id)) node = node.parentId ? allNodes.get(node.parentId) : undefined
    return node ? nodes.get(node.id) : undefined
  }
  const selectedNode = visibleNode(selectedId ?? graph.currentId) ?? nodes.get(graph.rootId)
  const selectedNodeRef = useRef(selectedNode)
  selectedNodeRef.current = selectedNode
  const weightOf = (node: ExecutionNode) => weight === 'tokens' ? node.summary.tokens : node.summary.measuredMs
  const maxWeight = Math.max(1, ...layout.nodes.map(node => weightOf(node) ?? 0))
  const recordIndexes = useMemo(() => {
    const result = new Map<string, number>()
    for (const turn of turns) for (const group of turn.groups) for (const cell of group.cells) {
      result.set(trajectoryRecordId(cell), cell.index)
      if (cell.sourceMessage?.id) result.set(cell.sourceMessage.id, cell.index)
    }
    return result
  }, [turns])
  const recordIndex = (node: ExecutionNode) => recordIndexes.get(node.messageId ?? '') ?? recordIndexes.get(node.callId ?? '')
  const title = (node: ExecutionNode) => node.behavior ? t(`trajectory.execution.behavior.${node.behavior}`) : node.title || (node.kind === 'turn'
    ? node.turn === null ? t('trajectory.execution.between') : t('trajectory.map.turn', { turn: node.turn })
    : node.kind === 'request' && node.requestSeq !== undefined ? t('trajectory.execution.requestNumber', { count: node.requestSeq })
    : t(`trajectory.execution.kind.${node.kind}`))
  const summary = (node: ExecutionNode) => [
    node.summary.requests > 0 ? t('trajectory.execution.requests', { count: node.summary.requests }) : '',
    node.summary.tools > 0 ? t('trajectory.execution.toolCount', { count: node.summary.tools }) : '',
    node.summary.active > 0 ? t('trajectory.execution.active', { count: node.summary.active }) : '',
    node.summary.errors > 0 ? t('trajectory.execution.errorCount', { count: node.summary.errors }) : '',
    node.summary.background > 0 ? t('trajectory.execution.backgroundCount', { count: node.summary.background }) : '',
    node.summary.compactions > 0 ? t('trajectory.execution.compactions', { count: node.summary.compactions }) : '',
  ].filter(Boolean).join(' · ')
  const openInspector = (trigger: HTMLElement, nodeId = selectedNode?.id) => {
    inspectorTriggerRef.current = trigger
    if (nodeId) setSelectedId(nodeId)
    setInspectorOpen(true)
  }
  const closeInspector = () => {
    setInspectorOpen(false)
    requestAnimationFrame(() => inspectorTriggerRef.current?.focus({ preventScroll: true }))
  }
  const focusNode = (id: string) => {
    setOverrides(current => {
      const next = new Map(current)
      let node = allNodes.get(id)
      while (node?.parentId) {
        next.set(node.parentId, false)
        node = allNodes.get(node.parentId)
      }
      return next
    })
    setSelectedId(id)
    pendingFocusRef.current = id
  }
  useEffect(() => { if (inspectorOpen && isActive) inspectorCloseRef.current?.focus() }, [inspectorOpen, isActive])
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new ResizeObserver(() => setIsCompact(root.clientWidth <= 760))
    observer.observe(root)
    return () => observer.disconnect()
  }, [])
  const fit = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport?.clientWidth || !viewport.clientHeight) return false
    const scale = clampScale(Math.min((viewport.clientWidth - 48) / layout.width, (viewport.clientHeight - 48) / layout.height, 1))
    setTransform({ scale, x: (viewport.clientWidth - layout.width * scale) / 2, y: (viewport.clientHeight - layout.height * scale) / 2 })
    return true
  }, [layout.width, layout.height])
  const locate = () => {
    const viewport = viewportRef.current
    const current = visibleNode(graph.currentId)
    if (!viewport?.clientWidth || !viewport.clientHeight || !current) return false
    setSelectedId(current.id)
    const scale = clampScale(Math.min(1, (viewport.clientWidth - 48) / current.width))
    setTransform({ scale, x: viewport.clientWidth / 2 - (current.x + current.width / 2) * scale, y: viewport.clientHeight / 2 - (current.y + current.height / 2) * scale })
    return true
  }
  const locateRef = useRef(locate)
  locateRef.current = locate
  useLayoutEffect(() => {
    if (fittedRef.current) return
    const viewport = viewportRef.current
    if (!viewport?.clientWidth || !viewport.clientHeight) return
    const scale = Math.min((viewport.clientWidth - 48) / layout.width, (viewport.clientHeight - 48) / layout.height)
    fittedRef.current = scale >= 0.65 ? fit() : locateRef.current()
  }, [layout, fit])
  useLayoutEffect(() => {
    const id = pendingFocusRef.current
    const node = id ? nodes.get(id) : undefined
    const viewport = viewportRef.current
    if (!node || !viewport?.clientWidth) return
    pendingFocusRef.current = null
    setTransform(value => ({ ...value, x: viewport.clientWidth / 2 - (node.x + node.width / 2) * value.scale, y: viewport.clientHeight / 2 - (node.y + node.height / 2) * value.scale }))
  }, [nodes])
  // Preserve the selected anchor on collapse or streaming updates, without resetting user zoom.
  const anchorRef = useRef<{ id: string; x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    if (!selectedNode) return
    const previous = anchorRef.current
    anchorRef.current = { id: selectedNode.id, x: selectedNode.x, y: selectedNode.y }
    if (previous?.id !== selectedNode.id || !fittedRef.current) return
    if (previous.x !== selectedNode.x || previous.y !== selectedNode.y) {
      setTransform(value => ({ ...value, x: value.x + (previous.x - selectedNode.x) * value.scale, y: value.y + (previous.y - selectedNode.y) * value.scale }))
    }
  }, [selectedNode])
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      const next = { width: entry.contentRect.width, height: entry.contentRect.height }
      if (next.width <= 0 || next.height <= 0) return
      const previous = lastViewportSizeRef.current
      lastViewportSizeRef.current = next
      if (!fittedRef.current) { fittedRef.current = locateRef.current(); return }
      if (!previous.width || !previous.height) return
      setAnimateViewport(false)
      setTransform(value => resizeMapViewport(value, previous, next, selectedNodeRef.current))
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])
  const zoom = (factor: number, cx?: number, cy?: number) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const x = cx ?? viewport.clientWidth / 2, y = cy ?? viewport.clientHeight / 2
    setTransform(previous => {
      const scale = clampScale(previous.scale * factor), ratio = scale / previous.scale
      return { scale, x: x - (x - previous.x) * ratio, y: y - (y - previous.y) * ratio }
    })
  }
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    delete event.currentTarget.dataset.dragging
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return (
    <div ref={rootRef} className={styles.root} onKeyDown={event => {
      if (event.key === 'Escape' && inspectorOpen) { event.preventDefault(); event.stopPropagation(); closeInspector() }
    }}>
      <div className={styles.toolbar}>
        <select className={styles.turnFilter} aria-label={t('trajectory.execution.turnFilter')} value={turnFilter} onChange={event => { setTurnFilter(event.target.value); setSelectedId(null); fittedRef.current = false }}>
          <option value="all">{t('trajectory.execution.allTurns')}</option>
          {sourceGraph.nodes.filter(node => node.kind === 'turn' && node.turn !== null).map(node => <option key={node.id} value={node.turn!}>{t('trajectory.map.turn', { turn: node.turn })}</option>)}
        </select>
        <label className={styles.weightControl}>
          <span>{t('trajectory.execution.weight')}</span>
          <select value={weight} onChange={event => setWeight(event.target.value as 'duration' | 'tokens')}>
            <option value="duration">{t('trajectory.execution.measuredTime')}</option>
            <option value="tokens">{t('trajectory.execution.tokens')}</option>
          </select>
        </label>
        <div className={styles.actions}>
          <button type="button" onClick={() => { setAnimateViewport(true); zoom(0.84) }} aria-label={t('trajectory.map.zoomOut')}><Minus /></button>
          <span className={styles.scale}>{Math.round(transform.scale * 100)}%</span>
          <button type="button" onClick={() => { setAnimateViewport(true); zoom(1.19) }} aria-label={t('trajectory.map.zoomIn')}><Plus /></button>
          <button type="button" onClick={() => { setAnimateViewport(true); locate() }} aria-label={t('trajectory.execution.locate')}><LocateFixed /></button>
          <button type="button" onClick={() => { setAnimateViewport(true); fit() }} aria-label={t('trajectory.map.fit')}><Maximize2 /></button>
          <button type="button" aria-expanded={inspectorOpen} onClick={event => inspectorOpen ? closeInspector() : openInspector(event.currentTarget)} aria-label={t('trajectory.execution.details')}><PanelRight /></button>
        </div>
      </div>
      <div className={styles.executionLegend} aria-label={t('trajectory.execution.legend')}>
        <span><i data-edge="call" />{t('trajectory.execution.call')}</span>
        <span><i data-edge="contains" />{t('trajectory.execution.contains')}</span>
        <span><i data-edge="branch" />{t('trajectory.execution.sessionLink')}</span>
      </div>
      <div className={styles.body}>
        <div ref={viewportRef} className={styles.viewport} inert={isCompact && inspectorOpen}
          onWheel={event => {
            event.preventDefault(); setAnimateViewport(false)
            const rect = event.currentTarget.getBoundingClientRect()
            zoom(event.deltaY > 0 ? 0.9 : 1.1, event.clientX - rect.left, event.clientY - rect.top)
          }}
          onPointerDown={event => {
            if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
            setAnimateViewport(false)
            event.currentTarget.setPointerCapture(event.pointerId)
            dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: transform.x, originY: transform.y }
            event.currentTarget.dataset.dragging = 'true'
          }}
          onPointerMove={event => {
            const drag = dragRef.current
            if (drag?.pointerId === event.pointerId) setTransform(previous => ({ ...previous, x: drag.originX + event.clientX - drag.x, y: drag.originY + event.clientY - drag.y }))
          }} onPointerUp={endDrag} onPointerCancel={endDrag}>
          <div className={styles.canvas} data-animated={animateViewport} data-compact={transform.scale < 0.62}
            style={{ width: layout.width, height: layout.height, transform: `translate(${Math.round(transform.x)}px, ${Math.round(transform.y)}px) scale(${transform.scale})` }}>
            <svg className={styles.edges} width={layout.width} height={layout.height} aria-hidden="true">
              {layout.edges.map(edge => {
                const from = nodes.get(edge.from), to = nodes.get(edge.to)
                if (!from || !to) return null
                const side = to.x > from.x ? 1 : -1
                const x1 = side > 0 ? from.x + from.width : from.x, y1 = from.y + from.height / 2
                const x2 = side > 0 ? to.x : to.x + to.width, y2 = to.y + to.height / 2
                const path = `M ${x1} ${y1} C ${x1 + 36 * side} ${y1}, ${x2 - 36 * side} ${y2}, ${x2} ${y2}`
                return <path key={edge.id} d={path} className={styles[`${edge.kind}Edge`]} />
              })}
            </svg>
            {layout.nodes.map(node => <div key={node.id}
              className={`${styles.sessionCard} ${selectedNode?.id === node.id ? styles.selectedSession : ''}`}
              data-status={node.status} data-kind={node.kind}
              data-errors={node.summary.errors > 0}
              style={{ left: node.x, top: node.y, width: node.width, height: node.height }}>
              <button type="button" className={styles.sessionOpen} aria-pressed={selectedNode?.id === node.id}
                onClick={event => openInspector(event.currentTarget, node.id)}>
                <span className={styles.cardEyebrow}>
                  <i className={styles.statusDot} data-status={node.kind === 'behavior' && node.summary.active > 0 ? 'running' : node.status} />
                  {t(`trajectory.execution.kind.${node.kind}`)}
                  {node.kind !== 'turn' && node.kind !== 'behavior' && ` · ${t(`trajectory.execution.status.${node.status}`)}`}
                  {node.turn !== null && ` · T${node.turn}`}
                </span>
                <strong>{title(node)}</strong>
                <span className={styles.sessionPreview}>{node.kind === 'behavior'
                  ? [...new Set(node.children.map(id => title(allNodes.get(id)!)))].slice(0, 3).join(' · ')
                  : node.preview || (node.children.length > 0 ? t('trajectory.execution.directChildren', { count: node.children.length }) : '')}</span>
                <span className={styles.cardMeta} title={summary(node)}>{summary(node) || t(`trajectory.execution.status.${node.status}`)}</span>
                <span className={styles.weightLabel}>{weight === 'tokens' ? node.summary.tokens?.toLocaleString() ?? '—' : duration(node.summary.measuredMs)}{weight === 'duration' && node.summary.unmeasured > 0 ? ' *' : ''}</span>
              </button>
              <div className={styles.weightBar} aria-hidden="true" style={{ width: `${100 * Math.sqrt((weightOf(node) ?? 0) / maxWeight)}%` }} />
              {node.summary.errors > 0 && <span className={styles.errorBadge}>{t('trajectory.execution.errorCount', { count: node.summary.errors })}</span>}
              {node.children.length > 0 && <button type="button" className={styles.collapse} aria-expanded={!collapsed.has(node.id)}
                aria-label={t(collapsed.has(node.id) ? 'trajectory.execution.expand' : 'trajectory.execution.collapse')}
                onClick={() => setOverrides(current => new Map(current).set(node.id, !collapsed.has(node.id)))}>
                {collapsed.has(node.id) ? <ChevronRight /> : <ChevronDown />}{node.children.length}
              </button>}
            </div>)}
          </div>
        </div>
        {selectedNode && inspectorOpen && <aside className={styles.inspector} aria-label={title(selectedNode)}>
          <div className={styles.inspectorHeader}>
            <div className={styles.inspectorTop}>
              <span className={styles.cardEyebrow}>{t(`trajectory.execution.kind.${selectedNode.kind}`)}</span>
              <div className={styles.actions}><button ref={inspectorCloseRef} type="button" onClick={closeInspector} aria-label={t('common.close')}><X /></button></div>
            </div>
            <h3>{title(selectedNode)}</h3>
            <p>{selectedNode.preview}</p>
            {selectedNode.kind === 'behavior' && <p>{t('trajectory.execution.behaviorHint')}</p>}
            <p>{summary(selectedNode)}</p>
            {selectedNode.kind !== 'behavior' && <div className={styles.inspectorMeta}><span>{t(`trajectory.execution.status.${selectedNode.status}`)}</span></div>}
          </div>
          <div className={styles.executionDetails}>
            <dl>
              <dt>{t('trajectory.execution.measuredTime')}</dt><dd>{duration(selectedNode.summary.measuredMs)}</dd>
              <dt>{t('trajectory.execution.tokens')}</dt><dd>{selectedNode.summary.tokens?.toLocaleString() ?? '—'}</dd>
            </dl>
            <p>{t('trajectory.execution.measureHint')}</p>
            {selectedNode.summary.unmeasured > 0 && <p>{t('trajectory.execution.unmeasured', { count: selectedNode.summary.unmeasured })}</p>}
            {selectedNode.unresolvedParent && <p>{t('trajectory.execution.missingParent')}</p>}
            {selectedNode.kind === 'session' && selectedNode.id !== graph.rootId && <p>{t('trajectory.execution.sessionHint')}</p>}
          </div>
          <div className={styles.inspectorActions}>
            {recordIndex(selectedNode) !== undefined && <button type="button" onClick={() => onSelectRecord?.(recordIndex(selectedNode)!)} disabled={!onSelectRecord}>{t('trajectory.execution.viewRecord')}</button>}
            {selectedNode.kind === 'session' && selectedNode.sessionId !== sessionMap.currentSessionId && <button type="button" onClick={() => onOpenSession?.(selectedNode.sessionId)} disabled={!onOpenSession}>{t('common.open')}</button>}
          </div>
          <div className={styles.turnList}>
            {selectedNode.children.map(id => allNodes.get(id)!).map(child => <button type="button" key={child.id} className={styles.turnRow}
              onClick={() => focusNode(child.id)}>
              <span className={styles.statusDot} data-status={child.status} />
              <span className={styles.turnCopy}><strong>{title(child)}</strong><small>{summary(child) || child.preview}</small></span>
            </button>)}
            {graph.edges.filter(edge => edge.kind !== 'contains' && (edge.to === selectedNode.id || edge.from === selectedNode.id && !selectedNode.children.includes(edge.to))).map(edge => {
              const other = allNodes.get(edge.from === selectedNode.id ? edge.to : edge.from)!
              return <button type="button" key={edge.id} className={styles.turnRow}
                onClick={() => focusNode(other.id)}>
                <span className={styles.turnCopy}><strong>{title(other)}</strong><small>{t(edge.kind === 'call' ? 'trajectory.execution.call' : 'trajectory.execution.sessionLink')}{other.turn !== null ? ` · T${other.turn}` : ''}</small></span>
              </button>
            })}
          </div>
        </aside>}
      </div>
    </div>
  )
}
