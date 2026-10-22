import { describe, expect, it } from 'bun:test'
import { buildPlanApprovalMessage } from './plan-approval-message'

describe('desktop plan approval snapshot', () => {
  it('carries the exact rendered message instead of only approval prose', () => {
    const text = buildPlanApprovalMessage({ planPath: '/plan.md', planSnapshot: { id: 'rendered-v1', content: 'Only write a sourced report.' }, draftInput: 'Use Chinese.' })
    expect(text).toContain('Accepted plan message: rendered-v1')
    expect(text).toContain('Only write a sourced report.')
    expect(text).toContain('/plan.md')
    expect(text).toContain('Use Chinese.')
  })
  it('preserves the host-captured approval when compaction has removed local history', () => {
    const text = buildPlanApprovalMessage({ approvalMessageSnapshot: 'Accepted plan message: host-v1\nContent sha256: abc\nExact accepted scope.', draftInput: 'Keep citations.' })
    expect(text).toContain('host-v1')
    expect(text).toContain('Exact accepted scope.')
    expect(text).toContain('Keep citations.')
  })
})
