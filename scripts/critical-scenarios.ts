/** Single registry for existing offline critical acceptance paths. */
export const criticalTestGroups: [string, string[]][] = [
  ['.', ['scripts/check-environment.test.ts']],
  ['packages/server-core', [
    'src/durable-runtime/coordinator.test.ts',
    'src/durable-runtime/process-crash.test.ts',
    'src/durable-runtime/projection-runner.test.ts',
    'src/sessions/idle-session-cache.test.ts',
    'src/tasks/TaskRunner.test.ts',
    'src/transport/__tests__/server-lifecycle.test.ts',
    'src/webui/__tests__/http-server.isolated.ts',
  ]],
  ['packages/shared', [
    'src/sessions/__tests__/persistence-queue.test.ts',
    'src/durable-runtime/recovery.test.ts',
    'src/config/__tests__/theme.test.ts',
    'src/plugins/__tests__/plugin-install.isolated.ts',
  ]],
  ['packages/pi-agent-server', [
    'src/transport-delta.test.ts',
    'src/request-diagnostics.test.ts',
    'src/durable-model-stream.test.ts',
    'src/length-continuation.test.ts',
  ]],
  ['packages/ui', [
    'src/components/chat/__tests__/streaming-projection.test.ts',
    'src/components/chat/__tests__/turn-utils-grouping.test.ts',
  ]],
  ['apps/electron', [
    'src/renderer/atoms/__tests__/sessions.isolated.ts',
    'src/renderer/lib/__tests__/reconnect-recovery.test.ts',
    'src/main/__tests__/session-branch-rollback.isolated.ts',
  ]],
]


export const criticalWorkflows = [
  { id: 'verification-output', entry: 'scripts/verification/verification-output-workflow.ts', minimum: 7, required: ['verification-output.json'] },
  { id: 'governance-gates', entry: 'scripts/verification/governance-gates-workflow.ts', minimum: 8, required: ['governance-gates.json'] },
  { id: 'governance-closeout', entry: 'scripts/verification/governance-closeout-workflow.ts', minimum: 22, required: ['governance-closeout.json'] },
  { id: 'runtime-boundary-gate', entry: 'scripts/verification/runtime-boundary-gate-workflow.ts', minimum: 9, required: ['gate-mutations.json', 'gate-report.json'] },
  { id: 'durable-runtime-boundary', entry: 'scripts/verification/durable-runtime-boundary-workflow.ts', minimum: 15, required: ['workflow.json', 'workflow.db'] },
  { id: 'durable-runtime-crash', entry: 'scripts/verification/durable-runtime-crash-workflow.ts', minimum: 8,
    required: ['crash.json', ...['tool', 'model'].flatMap(kind => ['t1-failure', 'after-t1', 'after-effect', 'after-t2'].map(point => `crash-${kind}-${point}.db`))] },
  { id: 'plugin-transaction', entry: 'scripts/verification/plugin-transaction-workflow.ts', minimum: 13, required: ['plugin-transaction.json'] },
  { id: 'session-branch', entry: 'scripts/verification/session-branch-workflow.ts', minimum: 4, required: ['session-branch.json'] },
  { id: 'webui-auth-lifecycle', entry: 'scripts/verification/webui-auth-lifecycle-workflow.ts', minimum: 14, required: ['webui-auth-lifecycle.json', 'session-revocations.sqlite'] },
  { id: 'process-lifecycle', entry: 'scripts/verification/process-lifecycle-workflow.ts', minimum: 12, required: ['process-lifecycle.json', 'runtime-quiesce.log', 'bootstrap-stop.log'] },
  { id: 'config-domains', entry: 'scripts/verification/config-domains-workflow.ts', minimum: 22, required: ['config-domains.json'] },
  { id: 'rpc-contracts', entry: 'scripts/verification/rpc-contracts-workflow.ts', minimum: 7, required: ['rpc-contracts.json'] },
  { id: 'governance-boundaries', entry: 'scripts/verification/governance-boundaries-workflow.ts', minimum: 17, required: ['governance-boundaries.json'] },
  { id: 'import-graph', entry: 'scripts/verification/import-graph-workflow.ts', minimum: 7, required: ['import-graph.json'] },
  { id: 'cycle-gate', entry: 'scripts/verification/cycle-gate-workflow.ts', minimum: 6, required: ['cycle-gate.json'] },
  { id: 'pi-control', entry: 'scripts/verification/pi-control-workflow.ts', minimum: 9, required: ['pi-control.json'] },
  { id: 'durable-runtime-pi', entry: 'scripts/verification/durable-runtime-pi-workflow.ts', minimum: 6, required: ['independent-pi.json', 'independent-pi.db'] },
  { id: 'session-owners', entry: 'scripts/verification/session-owners-workflow.ts', minimum: 8, required: ['session-owners.json'] },
  { id: 'client-platform', entry: 'scripts/verification/client-platform-workflow.ts', minimum: 24, required: ['client-platform.json', 'webui-420.png', 'webui-1280.png', 'web-conversation.json', 'web-file-preview.png', 'web-plan.png', 'conversation-provider.json', 'web-conversation-runtime.json', 'web-conversation.db'] },
  { id: 'markdown-popout', entry: 'scripts/verification/markdown-popout-workflow.ts', minimum: 18, required: ['markdown-popout.json', 'message-light.png', 'source-light.png', 'source-dark.png', 'source-390.png', 'trace.zip'] },
  { id: 'distribution-inputs', entry: 'scripts/verification/distribution-inputs-workflow.ts', minimum: 10, required: ['distribution-inputs.json'] },
  { id: 'identity-gate', entry: 'scripts/verification/identity-gate-workflow.ts', minimum: 6, required: ['identity-gate.json'] },
] as const
