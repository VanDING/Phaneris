import * as React from 'react'
import { createPortal } from 'react-dom'
import { useEffect, useMemo, useReducer, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getMenuIcon } from './menu-icons'
import { motion, AnimatePresence, useIsPresent } from 'motion/react'
import { MOTION_DURATION, MOTION_SPRING } from '@phaneris/ui/motion'
import { useRegisterDismissibleLayer } from '@/context/DismissibleLayerContext'
import { PhanerisSymbol } from '../icons/PhanerisSymbol'
import { SquarePenRounded } from '../icons/SquarePenRounded'
import { SETTINGS_ICONS } from '../icons/SettingsIcons'
import { TopBarButton } from '../ui/TopBarButton'
import { MobileMenuPage } from './MobileMenuPage'
import { MobileMenuItem, type MobileMenuItemAffordance } from './MobileMenuItem'
import {
  buildMobileMenuPages,
  type MobileMenuPage as PageDefinition,
  type MobileMenuPageId,
  type MobileMenuRow,
} from './mobile-menu-pages'
import type { AppMenuProps } from './types'

const SNAPPY_SPRING = MOTION_SPRING.spatial
const BACKDROP_FADE = { duration: MOTION_DURATION.standard }

type StackAction =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'push'; page: MobileMenuPageId }
  | { type: 'pop' }
  | { type: 'reset' }

interface SheetState {
  isOpen: boolean
  /** Page IDs currently on the stack. The first is always 'root'. */
  stack: MobileMenuPageId[]
}

const INITIAL_STATE: SheetState = { isOpen: false, stack: ['root'] }

function stackReducer(state: SheetState, action: StackAction): SheetState {
  switch (action.type) {
    case 'open':
      return { isOpen: true, stack: ['root'] }
    case 'close':
      return { isOpen: false, stack: ['root'] }
    case 'push':
      // Guard against pushing duplicates if motion fires twice.
      if (state.stack[state.stack.length - 1] === action.page) return state
      return { ...state, stack: [...state.stack, action.page] }
    case 'pop':
      if (state.stack.length <= 1) return state
      return { ...state, stack: state.stack.slice(0, -1) }
    case 'reset':
      return INITIAL_STATE
  }
}

function getIcon(name: string): React.ComponentType<{ className?: string }> | null {
  return getMenuIcon(name)
}

function renderRowIcon(iconName: string, rowId: string): React.ReactNode {
  // The schema's "newChat" item declares icon: 'SquarePen' but we render the
  // local rounded variant to match the desktop dropdown.
  if (rowId === 'newChat') {
    return <SquarePenRounded className="h-5 w-5" />
  }
  // Settings rows pull from the dedicated SETTINGS_ICONS map (custom-shaped icons).
  const settingsKey = rowId.startsWith('settings-') ? rowId.replace(/^settings-/, '') : null
  if (settingsKey && settingsKey !== 'overview') {
    const Icon = SETTINGS_ICONS[settingsKey as keyof typeof SETTINGS_ICONS]
    if (Icon) return <Icon className="h-5 w-5" />
  }
  const Icon = getIcon(iconName)
  return Icon ? <Icon className="h-5 w-5" /> : null
}

function affordanceFor(action: MobileMenuRow['action']): MobileMenuItemAffordance {
  switch (action.kind) {
    case 'navigate':
      return 'chevron'
    case 'url':
      return 'external'
    default:
      return 'none'
  }
}

/**
 * Mobile AppMenu — Craft logo trigger that opens a full-screen, navigation-stack sheet.
 *
 * Mounted only when `AppShellContext.isCompactMode === true` via the `AppMenu` router.
 *
 * Sheet rendering is portalled into the closest element marked with
 * `data-mobile-menu-root` (SurfaceContainer in production, MobileWebUIFrame
 * in the playground). Falls back to `document.body` if no marker is found.
 */
export function MobileAppMenu(props: AppMenuProps) {
  const { t } = useTranslation()
  const [state, dispatch] = useReducer(stackReducer, INITIAL_STATE)
  const [isDebugMode, setIsDebugMode] = useState(false)

  useEffect(() => {
    window.electronAPI.isDebugMode().then(setIsDebugMode)
  }, [])

  const pages = useMemo(
    () => buildMobileMenuPages({ hasNewWindow: !!props.onNewWindow, isDebugMode }),
    [props.onNewWindow, isDebugMode],
  )

  const close = React.useCallback(() => dispatch({ type: 'close' }), [])
  const pop = React.useCallback(() => dispatch({ type: 'pop' }), [])

  // Rows that opened a sub-page, keyed by the page they opened. A popped page
  // takes its back button (and therefore keyboard focus) with it, so returning
  // focus to the row that opened it keeps the stack operable from the keyboard.
  // Keying by page id keeps this in step with the reducer, which ignores a
  // duplicate push rather than growing the stack.
  const focusReturnRef = React.useRef<Partial<Record<MobileMenuPageId, HTMLElement>>>({})
  const previousStackRef = React.useRef(state.stack)

  React.useEffect(() => {
    const previousStack = previousStackRef.current
    previousStackRef.current = state.stack
    // Closing the sheet resets the stack as well; the sheet is going away and
    // focus belongs to whoever owns it next, not to a row inside an exit.
    if (!state.isOpen || state.stack.length >= previousStack.length) return

    const trigger = focusReturnRef.current[previousStack[previousStack.length - 1]!]
    if (!trigger?.isConnected) return

    const active = document.activeElement
    const stranded = !(active instanceof HTMLElement) || active === document.body
      || active.closest('[data-page-present="false"]') !== null
    if (stranded) trigger.focus({ preventScroll: true })
  }, [state.stack, state.isOpen])

  // NOTE: We deliberately do NOT bridge to `window.history` here. NavigationContext
  // owns `history.pushState` for the app's routing, and any `history.back()` call
  // on close races with route changes fired from menu actions (e.g. Settings → AI),
  // rolling them back. iOS Safari edge-swipe-back will navigate the whole tab away
  // instead of popping a sub-page — accept that as a known UX gap; the close X
  // and back chevron are the supported dismissal paths.

  // Register with the dismissible layer registry so Escape/back behavior nests cleanly.
  // Priority 0 keeps us under permission/credential prompts (which register higher).
  const layerRegistration = useMemo(
    () => state.isOpen ? {
      id: 'mobile-app-menu',
      type: 'modal' as const,
      priority: 0,
      isOpen: true,
      close,
      canBack: () => state.stack.length > 1,
      back: () => {
        if (state.stack.length > 1) {
          pop()
          return true
        }
        return false
      },
    } : null,
    [state.isOpen, state.stack.length, close, pop],
  )
  useRegisterDismissibleLayer(layerRegistration)

  const dispatchAction = (row: MobileMenuRow) => {
    switch (row.action.kind) {
      case 'navigate': {
        // Remember where the sub-page was opened from, before the row's own
        // focus is lost with it. `body` means nothing was focused (a synthetic
        // activation, or a click on non-focusable chrome) and focusing it back
        // would be a no-op, so it is not recorded. See the pop effect above.
        const active = document.activeElement
        if (active instanceof HTMLElement && active !== document.body) {
          focusReturnRef.current[row.action.to] = active
        }
        dispatch({ type: 'push', page: row.action.to })
        return
      }
      case 'callback':
        switch (row.action.key) {
          case 'newChat': props.onNewChat(); break
          case 'newWindow': props.onNewWindow?.(); break
          case 'openSettings': props.onOpenSettings(); break
        }
        close()
        return
      case 'settingsSubpage':
        props.onOpenSettingsSubpage(row.action.subpage)
        close()
        return
      case 'url':
        window.electronAPI.openUrl(row.action.url)
        close()
        return
      case 'electronApi':
        switch (row.action.method) {
          case 'checkForUpdates': window.electronAPI.checkForUpdates(); break
          case 'installUpdate': window.electronAPI.installUpdate(); break
          case 'menuToggleDevTools': window.electronAPI.menuToggleDevTools(); break
        }
        return
    }
  }

  return (
    <>
      <TopBarButton
        onClick={() => {
          if (state.isOpen) {
            close()
            return
          }
          // A fresh stack: no rows from a previous session can be valid targets.
          focusReturnRef.current = {}
          previousStackRef.current = ['root']
          dispatch({ type: 'open' })
        }}
        aria-label={t('menu.appMenu')}
        data-state={state.isOpen ? 'open' : 'closed'}
        className="rounded-[8px]"
      >
        <PhanerisSymbol className="!h-5 !w-auto text-accent" />
      </TopBarButton>
      <MobileMenuSheet
        state={state}
        pages={pages}
        onPop={pop}
        onClose={close}
        onActivateRow={dispatchAction}
        t={t}
      />
    </>
  )
}

interface SheetProps {
  state: SheetState
  pages: PageDefinition[]
  onPop: () => void
  onClose: () => void
  onActivateRow: (row: MobileMenuRow) => void
  t: (key: string) => string
}

function MobileMenuSheet({ state, pages, onPop, onClose, onActivateRow, t }: SheetProps) {
  const portalTarget = useMobileMenuPortalTarget(state.isOpen)
  if (!portalTarget) return null

  // True while the sheet is open OR animating out — AnimatePresence handles the rest.
  const sheet = (
    <AnimatePresence>
      {state.isOpen && (
        <motion.div
          key="mobile-app-menu-sheet"
          className="absolute inset-0 z-modal"
          initial="closed"
          animate="open"
          exit="closed"
        >
          {/* Backdrop dim — only meaningful when the portal target has visible siblings,
              but cheap and harmless otherwise. */}
          <motion.div
            className="absolute inset-0 bg-foreground/30"
            variants={{ open: { opacity: 1 }, closed: { opacity: 0 } }}
            transition={BACKDROP_FADE}
            onClick={onClose}
          />
          <motion.div
            className="absolute inset-0 bg-background overflow-hidden"
            variants={{ open: { y: '0%' }, closed: { y: '100%' } }}
            transition={SNAPPY_SPRING}
          >
            <PageStack
              pages={pages}
              stack={state.stack}
              onPop={onPop}
              onClose={onClose}
              onActivateRow={onActivateRow}
              t={t}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  return createPortal(sheet, portalTarget)
}

interface PageStackProps {
  pages: PageDefinition[]
  stack: MobileMenuPageId[]
  onPop: () => void
  onClose: () => void
  onActivateRow: (row: MobileMenuRow) => void
  t: (key: string) => string
}

interface StackPageProps {
  page: PageDefinition
  depth: number
  /** Deepest page in the stack: the only one that may take input. */
  isTop: boolean
  onPop: () => void
  onClose: () => void
  onActivateRow: (row: MobileMenuRow) => void
  t: (key: string) => string
}

/**
 * One page of the menu stack.
 *
 * Deeper pages are opaque and cover the ones below, which is why the lower
 * pages stay mounted — the stack keeps each page's scroll position and state.
 * Being covered is not the same as being gone, though: every page except the
 * top one is `inert` and out of the accessibility tree so Tab, Escape and
 * screen-reader order follow what is actually visible.
 *
 * `useIsPresent` carries the same guarantee through the exit animation. It is
 * the only signal that stays live after a page leaves the stack, because
 * AnimatePresence re-renders the exiting element with its previous props.
 */
function StackPage({ page, depth, isTop, onPop, onClose, onActivateRow, t }: StackPageProps) {
  const isPresent = useIsPresent()
  const isInteractive = isPresent && isTop

  return (
    <motion.div
      className="absolute inset-0"
      // Deeper pages sit on top so a page keeps covering the stack underneath
      // while it animates out.
      style={{ zIndex: depth }}
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={SNAPPY_SPRING}
      inert={!isInteractive}
      aria-hidden={!isInteractive || undefined}
      data-page-present={isPresent ? 'true' : 'false'}
    >
      <MobileMenuPage
        title={t(page.titleKey)}
        showBack={depth > 0}
        onBack={onPop}
        onClose={onClose}
      >
        <ul className="py-2">
          {page.rows.map((row) => (
            <li key={row.id}>
              <MobileMenuItem
                icon={renderRowIcon(row.iconName, row.id)}
                label={t(row.labelKey)}
                affordance={affordanceFor(row.action)}
                onClick={() => onActivateRow(row)}
              />
            </li>
          ))}
        </ul>
      </MobileMenuPage>
    </motion.div>
  )
}

/**
 * Renders the page stack with a slide-in / slide-out animation per sub-page.
 * Lower pages stay rendered underneath but are visually covered.
 */
function PageStack({ pages, stack, onPop, onClose, onActivateRow, t }: PageStackProps) {
  const topDepth = stack.length - 1

  return (
    <div className="absolute inset-0">
      {/* One presence boundary per page: without it a popped page leaves the
          tree immediately and its `exit` is never played. `initial={false}`
          keeps the root page from sliding in behind the sheet's own entry. */}
      <AnimatePresence initial={false}>
        {stack.map((pageId, depth) => {
          const page = pages.find((p) => p.id === pageId)
          if (!page) return null
          return (
            <StackPage
              key={pageId}
              page={page}
              depth={depth}
              isTop={depth === topDepth}
              onPop={onPop}
              onClose={onClose}
              onActivateRow={onActivateRow}
              t={t}
            />
          )
        })}
      </AnimatePresence>
    </div>
  )
}

/**
 * Resolves the portal target for the sheet. Returns `null` until the document is
 * available (SSR-safety / initial mount) and re-resolves whenever the sheet opens
 * so demos that mount after the first render still work.
 */
function useMobileMenuPortalTarget(isOpen: boolean): HTMLElement | null {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!isOpen) return
    const found = document.querySelector('[data-mobile-menu-root]')
    setTarget((found as HTMLElement | null) ?? document.body)
  }, [isOpen])
  return target
}
