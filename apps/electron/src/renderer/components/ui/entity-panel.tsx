/**
 * EntityPanel<T> — Config-driven entity list with built-in keyboard nav + multi-select.
 *
 * Wraps EntityList + EntityRow + useEntityListInteractions so consumers
 * only provide a data mapping via `mapItem`.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X } from 'lucide-react'
import { Center, Stack } from '@phaneris/ui'
import { useAction } from '@/actions'
import { EntityList } from './entity-list'
import { EntityRow } from './entity-row'
import { useEntityListInteractions } from '@/hooks/useEntityListInteractions'
import type { createEntitySelection } from '@/hooks/useEntitySelection'

export interface EntityPanelItem {
  icon?: React.ReactNode
  resourceIcon?: boolean
  beforeMenu?: React.ReactNode
  title: React.ReactNode
  /** Optional second line between the title and the badges row */
  subtitle?: React.ReactNode
  badges?: React.ReactNode
  trailing?: React.ReactNode
  menu?: React.ReactNode
  dataAttributes?: Record<string, string | undefined>
}

export interface EntityPanelProps<T> {
  items: T[]
  getId: (item: T) => string
  mapItem: (item: T) => EntityPanelItem
  selection: ReturnType<typeof createEntitySelection>
  onItemClick: (item: T) => void
  selectedId?: string | null
  emptyState?: React.ReactNode
  /** Items are still loading: withhold the empty state, mark the list busy. */
  loading?: boolean
  /**
   * The text a filter query is matched against, per item.
   *
   * Supplying this turns on the filter field. Only the session list had search;
   * Sources, Skills and Plugins — the three lists whose whole job is "find the
   * one named X" — had none, so at 50 entries the only way to locate one was to
   * scroll and read. Matching is on the *label*, not on the rendered node, so a
   * highlighted or icon-bearing title still filters by what the user sees as
   * words.
   */
  filterText?: (item: T) => string
  /** Shown in the filter field; defaults to a generic "Filter…". */
  filterPlaceholder?: string
  /** Message when the filter matches nothing. */
  filterEmptyLabel?: string
  className?: string
  /** Extra data/aria attributes merged onto the inner list container.
   *  Use to set `data-list-role` so compact-mode CSS can target the right list. */
  containerProps?: Record<string, string>
}

export function EntityPanel<T>({
  items,
  getId,
  mapItem,
  selection,
  onItemClick,
  selectedId,
  emptyState,
  loading,
  filterText,
  filterPlaceholder,
  filterEmptyLabel,
  className,
  containerProps,
}: EntityPanelProps<T>) {
  const { t } = useTranslation()
  const [query, setQuery] = React.useState('')
  const normalisedQuery = query.trim().toLowerCase()
  // Filtering happens on the caller-supplied label so a row that renders
  // highlighted or icon-bearing text still matches what the user sees as words.
  const visibleItems = React.useMemo(() => {
    if (!filterText || !normalisedQuery) return items
    return items.filter(item => filterText(item).toLowerCase().includes(normalisedQuery))
  }, [items, filterText, normalisedQuery])

  const selectionStore = selection.useSelectionStore()
  const interactions = useEntityListInteractions<T>({
    items: visibleItems,
    getId,
    keyboard: {
      onNavigate: (item) => onItemClick(item),
      onActivate: (item) => onItemClick(item),
    },
    multiSelect: true,
    selectionStore,
  })

  useAction('navigator.clearSelection', () => {
    interactions.selection.clear()
  }, {
    enabled: () => interactions.selection.isMultiSelectActive,
  }, [interactions.selection])

  const mergedContainerProps = containerProps
    ? { ...interactions.listProps.containerProps, ...containerProps }
    : interactions.listProps.containerProps

  const filterField = filterText ? (
    <div className="shrink-0 px-2 pt-2 pb-1.5 border-b border-border/50">
      <div className="craft-field-shell relative rounded-shape-lg shadow-minimal bg-muted/50 has-[:focus-visible]:bg-background">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape' && query) {
              event.stopPropagation()
              setQuery('')
            }
          }}
          placeholder={filterPlaceholder ?? t('common.filter')}
          aria-label={filterPlaceholder ?? t('common.filter')}
          className="craft-field-input w-full h-8 pl-8 pr-8 text-body bg-transparent border-0 rounded-shape-lg outline-none placeholder:text-text-secondary [&::-webkit-search-cancel-button]:appearance-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="craft-icon-button craft-focus absolute right-1 top-1/2 -translate-y-1/2 inline-flex size-5 items-center justify-center rounded hover:bg-foreground/10"
            aria-label={t('common.clear')}
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
      </div>
    </div>
  ) : null

  // While a filter is active, "no rows" means "nothing matched", not "nothing
  // exists" — those need different words, so the empty state is replaced.
  const resolvedEmptyState = normalisedQuery
    ? (
        <Center className="px-4 py-10">
          <Stack gap="xs" align="center">
            <p className="text-body text-muted-foreground">{filterEmptyLabel ?? t('common.noMatches')}</p>
            <button type="button" onClick={() => setQuery('')} className="craft-row-focus text-meta text-foreground hover:underline">
              {t('session.clearSearch')}
            </button>
          </Stack>
        </Center>
      )
    : emptyState

  return (
    <EntityList
      items={visibleItems}
      getKey={getId}
      containerRef={interactions.listProps.containerRef}
      containerProps={mergedContainerProps}
      className={className}
      emptyState={resolvedEmptyState}
      loading={loading}
      header={filterField}
      renderItem={(item, index, isFirst) => {
        const mapped = mapItem(item)
        const rowProps = interactions.getRowProps(item, index)
        return (
          <EntityRow
            icon={mapped.icon}
            resourceIcon={mapped.resourceIcon}
            beforeMenu={mapped.beforeMenu}
            title={mapped.title}
            subtitle={mapped.subtitle}
            badges={mapped.badges}
            trailing={mapped.trailing}
            isSelected={selectedId === getId(item)}
            isInMultiSelect={rowProps.isInMultiSelect}
            showSeparator={!isFirst}
            onMouseDown={(e) => {
              rowProps.onMouseDown(e)
              if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button !== 2) {
                onItemClick(item)
              }
            }}
            buttonProps={rowProps.buttonProps}
            menuContent={mapped.menu}
            dataAttributes={mapped.dataAttributes}
          />
        )
      }}
    />
  )
}





