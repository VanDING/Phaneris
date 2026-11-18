/**
 * SkillAvatar - Thin wrapper around EntityIcon for skills.
 *
 * Sets fallbackIcon={Zap} and delegates all rendering to EntityIcon.
 * Use `fluid` prop for fill-parent sizing (e.g., Info_Page.Hero).
 */

import { Zap } from 'lucide-react'
import { EntityIcon } from '@/components/ui/entity-icon'
import { useEntityIcon } from '@/lib/icon-cache'
import { skillIconKey, useResourceIcon } from '@/lib/resource-icons'
import { ResourceIconArtwork } from './resource-icon-artwork'
import type { IconSize } from '@phaneris/shared/icons'
import { ICON_SIZE_CLASSES } from '@phaneris/shared/icons'
import type { ResourceIcon } from '@phaneris/shared/resources/icons'
import { cn } from '@/lib/utils'
import type { LoadedSkill } from '../../../shared/types'

interface SkillAvatarProps {
  /** LoadedSkill object */
  skill: LoadedSkill
  /** Size variant */
  size?: IconSize
  /** Fill parent container (h-full w-full). Overrides size. */
  fluid?: boolean
  /** Additional className overrides */
  className?: string
  /** Workspace ID for loading local icons */
  workspaceId?: string
  iconOverride?: ResourceIcon | null
}

export function SkillAvatar({ skill, size = 'md', fluid, className, workspaceId, iconOverride }: SkillAvatarProps) {
  const saved = useResourceIcon(workspaceId ?? '', skillIconKey(skill)).icon
  const icon = useEntityIcon({
    workspaceId: workspaceId ?? '',
    entityType: 'skill',
    identifier: skill.slug,
    iconPath: skill.iconPath,
    iconValue: skill.metadata.icon,
  })
  const override = iconOverride === undefined ? saved : iconOverride
  if (override) return <ResourceIconArtwork icon={override} className={cn(fluid ? 'size-full' : ICON_SIZE_CLASSES[size], className)} />

  return (
    <EntityIcon
      icon={icon}
      size={size}
      fallbackIcon={Zap}
      alt={skill.metadata.name}
      className={className}
      chromeless={fluid}
      containerClassName={fluid ? 'h-full w-full' : undefined}
    />
  )
}
