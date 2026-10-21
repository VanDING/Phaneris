import * as React from 'react'
import type { ComponentEntry } from './types'
import { SCALE_DRIFT_REPORT } from './scale-drift.generated'
import { FONT_SIZE_TIERS, RADIUS_TIERS, CONTROL_HEIGHT_TIERS } from '@phaneris/ui/scale-contract'
import { cn } from '@/lib/utils'

type Family = 'fontSize' | 'radius' | 'controlHeight'

const FAMILY_META: Record<Family, { label: string; contract: Record<string, number>; hint: string }> = {
  fontSize: { label: 'Font size', contract: FONT_SIZE_TIERS, hint: 'text-micro · text-meta · text-label · text-body · text-reading · text-title' },
  radius: { label: 'Radius', contract: RADIUS_TIERS, hint: 'rounded-shape-xs · -sm · -md · -lg · -xl' },
  controlHeight: { label: 'Control height', contract: CONTROL_HEIGHT_TIERS, hint: 'h-control-2xs · -xs · -sm · -md · -lg · -xl' },
}

function ScaleFamilyTable({ family, legacyOnly }: { family: Family; legacyOnly: boolean }) {
  const meta = FAMILY_META[family]
  const values = SCALE_DRIFT_REPORT.families[family].values as Record<string, number>
  const files = SCALE_DRIFT_REPORT.families[family].files as Record<string, number>
  const contractSet = new Set(Object.values(meta.contract).map(value => `${value}px`))
  const rows = Object.entries(values)
    .filter(([value]) => !legacyOnly || !contractSet.has(value))
    .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-title font-semibold">{meta.label}</h3>
        <span className="text-meta text-foreground/60">
          {SCALE_DRIFT_REPORT.families[family].count} sites · {rows.length} values
        </span>
      </div>
      <p className="text-meta text-foreground/60">{meta.hint}</p>
      <div className="overflow-x-auto rounded-shape-lg border border-border">
        <table className="w-full border-collapse text-label">
          <thead>
            <tr className="border-b border-border text-left text-meta text-foreground/60">
              <th className="px-3 py-2 font-medium">Value</th>
              <th className="px-3 py-2 font-medium">Occurrences</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Nearest class</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([value, count]) => {
              const px = parseFloat(value)
              const tier = Object.entries(meta.contract).reduce((best, entry) =>
                Math.abs(entry[1] - px) < Math.abs(best[1] - px) ? entry : best)
              const isContract = contractSet.has(value)
              return (
                <tr key={value} className="border-b border-border/70 last:border-0">
                  <td className="px-3 py-1.5 font-mono tabular-nums">{value}</td>
                  <td className="px-3 py-1.5 tabular-nums">{count}</td>
                  <td className="px-3 py-1.5">
                    <span className={cn(
                      'rounded-shape-xs px-1.5 py-0.5 text-meta font-medium',
                      isContract ? 'bg-success/10 text-success-text' : 'bg-info/10 text-info-text',
                    )}>
                      {isContract ? 'contract' : 'legacy'}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-meta text-foreground/70">
                    {isContract ? '—' : `${tier[0]} (${tier[1]}px)`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {family === 'controlHeight' && (
        <p className="text-meta text-foreground/50">
          Large heights (88px–600px) describe layout space, not hit targets; they are frozen in the legacy
          snapshot and only need migration when that surface is touched.
        </p>
      )}
      <p className="text-meta text-foreground/50">
        Top files: {Object.entries(files).sort((a, b) => b[1] - a[1]).slice(0, 5)
          .map(([file, count]) => `${file} (${count})`).join(' · ')}
      </p>
    </section>
  )
}

function ScaleDriftAudit() {
  const [legacyOnly, setLegacyOnly] = React.useState(false)

  return (
    <div className="w-full max-w-[1200px] space-y-6 p-6">
      <div className="space-y-2">
        <h2 className="text-title font-semibold">Scale Drift Audit</h2>
        <p className="text-body text-foreground/70">
          Live ledger for arbitrary scale literals in shipped UI sources (renderer, shared UI, WebUI and Viewer;
          tests and this playground are excluded). Contract tiers are the intended values; legacy values are
          frozen debt that must retire as their surfaces migrate. Regenerate the data with
          <span className="mx-1 font-mono text-meta">bun run scale:generate</span>.
        </p>
        <p className="text-meta text-foreground/60">
          Last measured: {SCALE_DRIFT_REPORT.generatedAt} · {SCALE_DRIFT_REPORT.filesScanned} files ·{' '}
          {SCALE_DRIFT_REPORT.excluded.playground} playground files excluded
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-meta text-foreground/60">Filter:</span>
        {[{ label: 'All values', value: false }, { label: 'Legacy only', value: true }].map(option => (
          <button
            key={option.label}
            type="button"
            onClick={() => setLegacyOnly(option.value)}
            className={cn(
              'craft-control h-7 rounded-shape-md px-2.5 text-meta font-medium transition-colors',
              legacyOnly === option.value
                ? 'bg-background text-foreground shadow-minimal'
                : 'bg-foreground/5 text-foreground/70 hover:bg-foreground/10',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <ScaleFamilyTable family="fontSize" legacyOnly={legacyOnly} />
      <ScaleFamilyTable family="radius" legacyOnly={legacyOnly} />
      <ScaleFamilyTable family="controlHeight" legacyOnly={legacyOnly} />
    </div>
  )
}

export const scaleDriftComponents: ComponentEntry[] = [
  {
    id: 'scale-drift-audit',
    name: 'Scale Drift Audit',
    category: 'Scale Drift',
    description: 'Font-size, radius and control-height contract tiers versus frozen legacy drift.',
    component: ScaleDriftAudit,
    props: [],
    layout: 'top',
    previewOverflow: 'auto',
  },
]
