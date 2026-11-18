import { BookOpen, ChartPie, CodeXml, Compass, Database, FileText, Folder, Globe, Layers, PenLine, ScanLine, Zap } from 'lucide-react'
import type { ResourceIcon } from '@phaneris/shared/resources/icons'
import { cn } from '@/lib/utils'

export const resourceIconGlyphs = {
  'file-text': FileText,
  'book-open': BookOpen,
  'chart-pie': ChartPie,
  'pen-line': PenLine,
  'scan-line': ScanLine,
  compass: Compass,
  database: Database,
  globe: Globe,
  folder: Folder,
  layers: Layers,
  'code-xml': CodeXml,
  zap: Zap,
}

export function ResourceIconArtwork({ icon, className }: { icon: ResourceIcon; className?: string }) {
  const Glyph = icon.kind === 'preset' ? resourceIconGlyphs[icon.name] : undefined
  return (
    <div className={cn('flex shrink-0 items-center justify-center overflow-hidden', className)} aria-hidden="true">
      {Glyph && <Glyph className="size-full" />}
      {icon.kind === 'image' && <img src={icon.src} alt="" className="size-full object-contain" />}
    </div>
  )
}
