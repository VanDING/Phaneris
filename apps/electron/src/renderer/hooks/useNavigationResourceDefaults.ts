import { useCallback } from 'react'
import { useAtomValue } from 'jotai'
import { sourcesAtom } from '@/atoms/sources'
import { skillsAtom } from '@/atoms/skills'
import type { SourceFilter } from '../../shared/types'

/** Default resource selection stays separate from Session/assistant startup. */
export function useNavigationResourceDefaults() {
  const sources = useAtomValue(sourcesAtom)
  const skills = useAtomValue(skillsAtom)
  const getFirstSourceSlug = useCallback((filter?: SourceFilter | null): string | null =>
    sources.find(source => !filter || source.config.type === filter.sourceType)?.config.slug ?? null, [sources])
  const getFirstSkillSlug = useCallback((): string | null => skills[0]?.slug ?? null, [skills])
  return { getFirstSourceSlug, getFirstSkillSlug }
}
