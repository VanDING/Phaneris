import { Shapes } from 'lucide-react'
import { EntityIcon } from '@/components/ui/entity-icon'
import { useEntityIcon } from '@/lib/icon-cache'
import type { IconSize } from '@phaneris/shared/icons'
import type { PluginSummary } from '../../../shared/types'

interface PluginAvatarProps {
  plugin: PluginSummary
  size?: IconSize
  fluid?: boolean
  className?: string
  workspaceId: string
}

export function PluginAvatar({ plugin, size = 'md', fluid, className, workspaceId }: PluginAvatarProps) {
  const icon = useEntityIcon({
    workspaceId,
    entityType: 'plugin',
    identifier: plugin.name,
    iconDir: `plugins/${plugin.name}`,
    iconValue: plugin.icon,
  })

  return (
    <EntityIcon
      icon={icon}
      size={size}
      fallbackIcon={Shapes}
      alt={plugin.name}
      className={className}
      containerClassName={fluid ? 'h-full w-full' : undefined}
    />
  )
}
