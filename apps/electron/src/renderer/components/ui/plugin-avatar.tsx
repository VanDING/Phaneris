import { Shapes } from 'lucide-react'
import { EntityIcon } from '@/components/ui/entity-icon'
import { useEntityIcon } from '@/lib/icon-cache'
import { useResourceIcon } from '@/lib/resource-icons'
import { ResourceIconArtwork } from './resource-icon-artwork'
import { ICON_SIZE_CLASSES, type IconSize } from '@phaneris/shared/icons'
import type { ResourceIcon } from '@phaneris/shared/resources/icons'
import { cn } from '@/lib/utils'
import type { PluginSummary } from '../../../shared/types'

interface PluginAvatarProps {
  plugin: PluginSummary
  size?: IconSize
  fluid?: boolean
  className?: string
  workspaceId: string
  iconOverride?: ResourceIcon | null
}

export function PluginAvatar({ plugin, size = 'md', fluid, className, workspaceId, iconOverride }: PluginAvatarProps) {
  const saved = useResourceIcon(workspaceId, `plugin:${plugin.name}`).icon
  const icon = useEntityIcon({
    workspaceId,
    entityType: 'plugin',
    identifier: plugin.name,
    iconDir: `plugins/${plugin.name}`,
    iconValue: plugin.icon,
  })
  const override = iconOverride === undefined ? saved : iconOverride
  if (override) return <ResourceIconArtwork icon={override} className={cn(fluid ? 'size-full' : ICON_SIZE_CLASSES[size], className)} />

  return (
    <EntityIcon
      icon={icon}
      size={size}
      fallbackIcon={Shapes}
      alt={plugin.name}
      className={className}
      chromeless={fluid}
      containerClassName={fluid ? 'h-full w-full' : undefined}
    />
  )
}
