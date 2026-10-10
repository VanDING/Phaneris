/* ============================================================================
   Run → 决策 视图改版 · 演示稿
   ----------------------------------------------------------------------------
   一份 fixture，三种信息架构。切换方向只换布局，不换数据。
   所有 token / 组件命名尽量与 apps/electron 的真实实现对齐，方便实施时照搬。
   ========================================================================== */

/* ── i18n ───────────────────────────────────────────────────────────────────
   带 (NEW) 的是本方案新增、需要补进 7 个 locale 的键；其余直接沿用现有键名。 */
const T = {
  'trajectory.decisions.title':        ['会话决策', 'Session decisions'],
  'trajectory.decisions.scope':        ['当前会话的全部已记录历史；分支与子任务分别统计。', 'All recorded history of this session. Branches and subtasks are counted separately.'],
  'trajectory.decisions.configure':    ['配置决策辅助', 'Configure assistance'],
  'trajectory.decisions.partial':      ['历史覆盖不完整：缺失的处理结果与费用关联保持未知。', 'Historical coverage is incomplete. Missing applications and cost links remain unknown.'],
  'trajectory.decisions.disabled':     ['决策辅助当前已关闭，已有会话记录仍可查看。', 'Assistance is currently off. Existing session records remain available.'],
  'trajectory.decisions.points':       ['决策事项', 'Decision points'],
  'trajectory.decisions.changed':      ['实际改变', 'Actual changes'],
  'trajectory.decisions.fallback':     ['回退', 'Fallbacks'],
  'trajectory.decisions.cost':         ['决策费用', 'Decision cost'],
  'trajectory.decisions.features':     ['已使用功能', 'Features used'],
  'trajectory.decisions.records':      ['决策记录', 'Decision records'],
  'trajectory.decisions.allFeatures':  ['全部功能', 'All features'],
  'trajectory.decisions.allStatuses':  ['全部状态', 'All statuses'],
  'trajectory.decisions.allTurns':     ['全部轮次', 'All turns'],
  'trajectory.decisions.turn':         ['轮次', 'Turn'],
  'trajectory.decisions.includedCost': ['已计入会话费用；辅助 Token 不占用主模型上下文。', 'Already included in session cost. Auxiliary tokens do not occupy the main model’s context.'],
  'trajectory.decisions.accounting':   ['{{requests}} 次请求 · {{unconfirmed}} 待确认 · {{failures}} 次失败 · {{cancelled}} 次取消 · 输入 {{input}} / 输出 {{output}} Token',
                                        '{{requests}} requests · {{unconfirmed}} unconfirmed · {{failures}} failed · {{cancelled}} cancelled · {{input}} input / {{output}} output tokens'],
  'trajectory.decisions.loadMore':     ['显示更多', 'Show more'],
  'trajectory.decisions.noMatches':    ['没有符合筛选条件的记录。', 'No matching decisions.'],
  'trajectory.decisions.empty':        ['本会话尚无决策记录。', 'No recorded decisions in this session.'],
  'trajectory.decisions.emptyHint':    ['功能启用后首次触发时才会产生记录；打开此页不会调用模型。', 'Records appear when an enabled feature first triggers. Opening this page does not call a model.'],
  'trajectory.decisions.loadFailed':   ['无法读取会话决策。', 'Could not load session decisions.'],
  'trajectory.decisions.unsupported':  ['该服务器版本不支持会话决策记录，配置功能不受影响。', 'This server does not support session decision records. Configuration is unaffected.'],
  'trajectory.decisions.structuredEvidence': ['结构化证据', 'Structured evidence'],
  'trajectory.decisions.openChat':     ['回到来源消息', 'Open source message'],
  'trajectory.decisions.trigger':      ['触发场景', 'Trigger'],
  'trajectory.decisions.recommendation': ['模型判断', 'Recommendation'],
  'trajectory.decisions.application':  ['实际处理', 'Actual handling'],
  'trajectory.decisions.observations': ['后续观察', 'Later observations'],
  'trajectory.decisions.requests':     ['请求明细', 'Model attempts'],
  'trajectory.decisions.privacy':      ['只保存结构化答案与输入摘要，不保留原始输入。', 'Only structured answers and an input digest are stored. The original input is not retained.'],
  'trajectory.decisions.applicationUnknown': ['处理结果未确认。模型建议不等于已经执行。', 'Application was not confirmed. A recommendation is not evidence of execution.'],
  'trajectory.decisions.triggerUnknown': ['未记录来源关联。', 'Source link was not recorded.'],
  'trajectory.decisions.noObservations': ['没有后续观察记录。', 'No later observations recorded.'],
  'trajectory.decisions.noRecommendation': ['没有记录模型建议。', 'No recommendation recorded.'],
  'trajectory.decisions.unavailableReason': ['未发起调用：{{reason}}', 'Not requested: {{reason}}'],
  'trajectory.decisions.attempt.succeeded': ['已应答', 'Answered'],
  'trajectory.decisions.attempt.failed':    ['失败', 'Failed'],
  'trajectory.decisions.attempt.timeout':   ['超时', 'Timed out'],
  'trajectory.decisions.attempt.cancelled': ['已取消', 'Cancelled'],
  'trajectory.decisions.attempt.pending':   ['进行中', 'Pending'],
  'trajectory.decisions.attempt.unknown':   ['未知', 'Unknown'],
  'trajectory.decisions.attemptCount': ['{{count}} 次模型尝试', '{{count}} model attempts'],
  'trajectory.decisions.attemptCount_one': ['{{count}} 次模型尝试', '{{count}} model attempt'],
  'trajectory.decisions.featureCounts': ['{{points}} 项 · {{changed}} 次改变', '{{points}} points · {{changed}} changes'],
  'trajectory.decisions.featureCounts_one': ['{{points}} 项 · {{changed}} 次改变', '{{points}} point · {{changed}} changes'],
  'trajectory.decisions.legacyCalls':  ['另有 {{count}} 条历史请求，事项归属与执行结果未确认。', '{{count}} additional historical calls lack confirmed point grouping and applications.'],
  'trajectory.decisions.legacyCalls_one': ['另有 {{count}} 条历史请求，事项归属与执行结果未确认。', '{{count}} additional historical call lacks confirmed point grouping and application.'],

  /* status vocabulary — status.applied 目前缺失，是本方案要补的第一个键 */
  'trajectory.decisions.status.changed':     ['已改变', 'Changed'],
  'trajectory.decisions.status.applied':     ['已应用', 'Applied'],                        /* (NEW) */
  'trajectory.decisions.status.unchanged':   ['保持原样', 'Unchanged'],
  'trajectory.decisions.status.fallback':    ['回退', 'Fallback'],
  'trajectory.decisions.status.discarded':   ['已丢弃', 'Discarded'],
  'trajectory.decisions.status.failed':      ['失败', 'Failed'],
  'trajectory.decisions.status.cancelled':   ['已取消', 'Cancelled'],
  'trajectory.decisions.status.pending':     ['进行中', 'In progress'],
  'trajectory.decisions.status.unconfirmed': ['未确认', 'Unconfirmed'],
  'trajectory.decisions.status.historical':  ['历史记录', 'Historical'],

  /* (NEW) 本方案新增的界面文案 */
  'runD.search':        ['筛选记录…', 'Filter records…'],                                  /* (NEW) */
  'runD.clear':         ['清除筛选', 'Clear filters'],                                      /* (NEW) */
  'runD.count':         ['{{shown}} / {{total}} 条', '{{shown}} of {{total}}'],             /* (NEW) */
  'runD.showMore':      ['显示更多（还有 {{n}} 条）', 'Show more ({{n}} left)'],            /* (NEW) */
  'runD.selectHint':    ['选择一条记录查看详情', 'Select a record to inspect'],             /* (NEW) */
  'runD.selectHintSub': ['↑ ↓ 移动，Enter 打开', 'Move with ↑ ↓, open with Enter'],         /* (NEW) */
  'runD.back':          ['返回列表', 'Back to list'],                                       /* (NEW) */
  'runD.unknown':       ['未知', 'Unknown'],                                                /* (NEW) */
  'runD.unknownPill':   ['未知 ×{{n}}', 'Unknown ×{{n}}'],                                  /* (NEW) */
  'runD.unknownNote':   ['{{n}} 次请求未报告费用', '{{n}} requests reported no cost'],      /* (NEW) */
  'runD.diag':          ['诊断', 'Diagnostics'],                                            /* (NEW) */
  'runD.raw':           ['原始记录', 'Raw record'],                                         /* (NEW) */
  'runD.sessionLevel':  ['会话级', 'Session level'],                                        /* (NEW) */
  'runD.turnN':         ['第 {{n}} 轮', 'Turn {{n}}'],                                      /* (NEW) */
  'runD.matrix':        ['功能对比', 'Feature comparison'],                                  /* (NEW) */
  'runD.byTurn':        ['按轮次', 'By turn'],                                              /* (NEW) */
  'runD.flat':          ['全部', 'All'],                                                    /* (NEW) */
  'runD.noSession':     ['没有绑定会话', 'No session bound'],                                /* (NEW) */
  'runD.noSessionHint': ['在 Run 面板中固定一个会话后，这里会显示它的决策记录。', 'Pin a session in the Run panel to see its decision records.'], /* (NEW) */
  'runD.loading':       ['正在读取会话决策', 'Loading session decisions'],                    /* (NEW) */
  'runD.loadingHint':   ['只读；不会调用决策模型。', 'Read-only. No decision model is called.'], /* (NEW) */
  'runD.retry':         ['重试', 'Retry'],                                                  /* (NEW) */
  'runD.outcome':       ['处理结果', 'Outcome'],                                            /* (NEW) */
  'runD.time':          ['时间', 'Time'],                                                   /* (NEW) */
  'runD.action':        ['动作', 'Action'],                                                 /* (NEW) */
  'runD.baseline':      ['当时基线', 'Baseline'],                                            /* (NEW) */
  'runD.reason':        ['原因', 'Reason'],                                                 /* (NEW) */
  'runD.observed':      ['观察', 'Observed'],                                               /* (NEW) */
  'runD.confidence':    ['置信度', 'Confidence'],                                            /* (NEW) */
  'runD.latency':       ['耗时', 'Latency'],                                                /* (NEW) */
  'runD.tokens':        ['Token', 'Tokens'],                                                /* (NEW) */
  'runD.model':         ['模型', 'Model'],                                                  /* (NEW) */
  'runD.locate':        ['在轨迹中定位', 'Locate in Trajectory'],                            /* (NEW) */
  'runD.total':         ['合计', 'Total'],                                                  /* (NEW) */
  'runD.filtered':      ['已筛选', 'Filtered'],                                              /* (NEW) */
  'runD.feature':       ['功能', 'Feature'],                                                /* (NEW) */
  'runD.notTriggered':  ['本会话尚无决策记录', 'No decisions recorded yet'],                  /* (NEW) */
}

const ACTION = {
  keep_title:      ['保持标题', 'Keep title'],
  refresh_title:   ['刷新标题', 'Refresh title'],
  defer_title:     ['暂不生成标题', 'Defer title generation'],
  title_now:       ['生成标题', 'Generate title'],
  badges:          ['附加风险标记', 'Add risk badges'],
  prompt:          ['请求人工确认', 'Request human confirmation'],
  allow:           ['按现有权限继续', 'Continue with existing permission'],
  keep:            ['保持现有配置', 'Keep existing configuration'],
  filter:          ['投递相关摘录', 'Deliver relevant result excerpts'],
  skip_summary:    ['使用预览与已存文件', 'Use preview and saved file'],
  queue:           ['排队到下一轮', 'Queue for the next turn'],
  steer:           ['投递到运行中的轮次', 'Deliver into the running turn'],
  merge:           ['合并排队消息', 'Merge queued messages'],
  separate:        ['分别处理消息', 'Handle messages separately'],
  labels:          ['添加匹配的标签', 'Add matching labels'],
  verdict:         ['采用任务裁定：{{value}}', 'Apply task verdict: {{value}}'],
  reask:           ['要求重新给出裁定', 'Request a well-formed verdict'],
  scoped:          ['只修复相关节点', 'Repair selected task nodes'],
  whole_dag:       ['修复整个任务图', 'Repair the entire task graph'],
  thinking:        ['使用思考级别：{{value}}', 'Use thinking level: {{value}}'],
  status:          ['设置会话状态：{{value}}', 'Set session status: {{value}}'],
  keep_status:     ['保持会话状态', 'Keep session status'],
  run:             ['运行自动化', 'Run automation'],
  skip:            ['跳过自动化', 'Skip automation'],
  tool_error:      ['返回工具错误', 'Return tool error'],
  advice_delivered:['已给出建议，采用情况未知', 'Advice delivered; adoption unknown'],
  unsure:          ['没有明确建议', 'No confident recommendation'],
  discard:         ['丢弃过期结果', 'Discard obsolete result'],
  hint_injected:   ['给出技能或数据源提示', 'Provide a skill or source suggestion'],
  summarize:       ['使用摘要路径', 'Use the summary path'],
  default:         ['使用配置的投递方式', 'Use configured delivery'],
  none:            ['保持现有处理', 'Keep existing handling'],
}

const REASON = {
  title_fresh:      ['标题仍然准确', 'Title still describes the conversation'],
  small_talk:       ['首条消息是闲聊', 'The session opened with small talk'],
  kept_level:       ['用户设置未被超过', 'Your setting was not exceeded'],
  no_rule_matched:  ['没有规则达到阈值', 'No rule cleared its threshold'],
  already_present:  ['标签已存在', 'Label already present'],
  model_unavailable:['服务不可达', 'Service unreachable'],
  timed_out:        ['超出调用时限', 'Call deadline exceeded'],
  cancelled_by_user:['用户取消了本轮', 'Cancelled by the user'],
  over_budget:      ['超过调用预算', 'Call budget exceeded'],
  not_configured:   ['未配置服务或凭据', 'Service or credential not configured'],
  no_goal:          ['智能体未提供目标', 'The agent provided no goal'],
}

const OBS = {
  title_regenerated: ['标题随后被刷新', 'Title was refreshed afterwards'],
  source_activated:  ['随后启用了所建议的数据源', 'The suggested source was activated afterwards'],
  original_opened:   ['随后访问了完整结果文件', 'The full result file was opened afterwards'],
  corrected_next:    ['下一轮修正了方向', 'The next turn corrected course'],
}

/* ── icons (lucide 风格，1.65 描边，与主题 iconStrokeWidth 一致) ───────────── */
const ICONS = {
  'git-branch': 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9a9 9 0 0 1-9 9',
  'lightbulb': 'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4',
  'gauge': 'm12 14 4-4M3.34 19a10 10 0 1 1 17.32 0',
  'filter': 'M3 6h18M7 12h10M10 18h4',
  'message-square': 'M22 17a2 2 0 0 1-2 2H6l-4 4V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z',
  'flag': 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  'type': 'M4 7V4h16v3M9 20h6M12 4v16',
  'shield': 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
  'triangle-alert': 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01',
  'tag': 'M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42zM7.5 7.5h.01',
  'zap': 'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z',
  'square-check': 'M21 10.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.5m-9.5 8 3 3L22 4',
  'wrench': 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z',
  'list-tree': 'M21 12h-8M21 6H8M21 18h-8M3 6v4c0 1.1.9 2 2 2h3M3 10v6c0 1.1.9 2 2 2h3',
  'activity': 'M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2',
  'layers': 'm12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83zM6.08 9.5l-3.5 1.6a1 1 0 0 0 0 1.81l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.83l-3.5-1.59M6.08 14.5l-3.5 1.6a1 1 0 0 0 0 1.81l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.83l-3.5-1.59',
  'chevron-right': 'm9 18 6-6-6-6',
  'chevron-down': 'm6 9 6 6 6-6',
  'arrow-left': 'm12 19-7-7 7-7M19 12H5',
  'arrow-right': 'M5 12h14m-7-7 7 7-7 7',
  'search': 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35',
  'settings': 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  'clock': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2',
  'external-link': 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  'info': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 16v-4M12 8h.01',
  'x': 'M18 6 6 18M6 6l12 12',
  'corner-down-right': 'm15 10 5 5-5 5M4 4v7a4 4 0 0 0 4 4h12',
  'ban': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm5.66-15.66L6.34 17.66',
  'cloud-off': 'm2 2 20 20M5.78 5.78A10 10 0 0 0 12 22a10 10 0 0 0 7.06-2.94M21.9 12.9A9.9 9.9 0 0 0 12 2a9.9 9.9 0 0 0-3.5.63M2 12h4M18 12h4',
  'inbox': 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  'chevron-up-down': 'm7 15 5 5 5-5M7 9l5-5 5 5',
}

function svg(name, cls = 'ic') {
  const d = ICONS[name] || ICONS.info
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`
}

/* ── feature registry (与 settings.ai.decisions.feature* 对齐) ───────────── */
const FEATURES = {
  decideTool:       { icon: 'git-branch',       zh: '智能体工具 (decide)', en: 'Agent tool (decide)' },
  suggestions:      { icon: 'lightbulb',        zh: '技能和数据源建议',    en: 'Skill and source suggestions' },
  adaptiveThinking: { icon: 'gauge',            zh: '自适应思考',          en: 'Adaptive thinking' },
  largeResults:     { icon: 'filter',           zh: '大型工具结果',        en: 'Large tool results' },
  midTurnMessages:  { icon: 'message-square',   zh: '轮次中的消息',        en: 'Mid-turn messages' },
  turnOutcome:      { icon: 'flag',             zh: '轮次结果',            en: 'Turn outcome' },
  smartTitles:      { icon: 'type',             zh: '更智能的标题',        en: 'Smarter titles' },
  guardedMode:      { icon: 'shield',           zh: '受保护模式',          en: 'Guarded mode' },
  riskBadges:       { icon: 'triangle-alert',   zh: '风险标记',            en: 'Risk badges' },
  semanticLabels:   { icon: 'tag',              zh: '语义标签规则',        en: 'Semantic label rules' },
  automationConditions: { icon: 'zap',          zh: '自动化条件',          en: 'Automation conditions' },
  taskVerdicts:     { icon: 'square-check',     zh: '任务裁定',            en: 'Task verdicts' },
  taskRepairs:      { icon: 'wrench',           zh: '定向任务修复',        en: 'Targeted task repairs' },
}

/* ── status vocabulary ─────────────────────────────────────────────────────
   色调沿用 Run 表格的 kindTag 语言：business（品牌紫）/ warn / error /
   neutral（module 灰）。不用绿色表示「已应用」—— 风险标记是信息辅助，
   绿色会被读成「已批准」，这是设计文档 §3.3 明令禁止的。 */
const STATUS = {
  changed:     { tone: 'business',       shape: 'dot' },
  applied:     { tone: 'business-quiet', shape: 'dot' },
  unchanged:   { tone: 'neutral',        shape: 'ring' },
  fallback:    { tone: 'warn',           shape: 'dot' },
  discarded:   { tone: 'dim',            shape: 'dot' },
  failed:      { tone: 'error',          shape: 'dot' },
  cancelled:   { tone: 'neutral',        shape: 'ring' },
  pending:     { tone: 'business',       shape: 'dot', pulse: true },
  unconfirmed: { tone: 'neutral',        shape: 'ring' },
  historical:  { tone: 'dim',            shape: 'ring' },
}

/** 修正后的状态推导。
 *  宿主有处理结果 → 以它为准；否则看请求层：失败/超时是「失败」，取消是「已取消」，
 *  全部成功但无人确认采用才是「未确认」；一次请求都没发出去才是「回退」。 */
function itemStatus(it) {
  if (it.legacy) return 'historical'
  const app = it.application
  if (app) {
    if (app.status === 'unknown') return 'unconfirmed'
    if (app.status === 'applied') return app.changed ? 'changed' : 'applied'
    return app.status                       // unchanged | fallback | discarded
  }
  if (it.attempts.length) {
    const s = new Set(it.attempts.map(a => a.status))
    if (s.has('pending')) return 'pending'
    if (s.has('failed') || s.has('timeout')) return 'failed'
    if (s.has('cancelled')) return 'cancelled'
    return 'unconfirmed'
  }
  if (it.unavailableReason) return 'fallback'   // 压根没发起请求，走了既定回退路径
  return 'unconfirmed'
}

/** 当前实现的状态推导 —— 仅用于「现状」对照，暴露两个不可达状态。 */
function itemStatusLegacy(it) {
  if (it.legacy) return 'historical'
  if (it.application?.status === 'applied' && it.application.changed) return 'changed'
  if (it.application) return it.application.status === 'unknown' ? 'unconfirmed' : it.application.status
  if (it.attempts.some(a => a.status === 'pending')) return 'pending'
  return 'unconfirmed'
}

/* ── fixture ───────────────────────────────────────────────────────────────
   规模取自现有验收截图：59 事项 / 4 改变 / 4 回退 / 3 未确认 / 3 失败 / 1 取消 /
   $0.06 + 4 次未知费用 / 8 项功能 / 59 次请求。 */
const TOTALS = {
  legacyCalls: 1, points: 59, requests: 59, changed: 4, fallback: 4, unconfirmed: 3,
  failures: 3, cancelled: 1, knownCostUsd: 0.06, knownCostRequests: 55, unknownCostRequests: 4,
  inputTokens: 385, outputTokens: 165,
}

const FEATURE_TOTALS = [
  { feature: 'suggestions',      points: 45, changed: 0, fallback: 1, failed: 2, cancelled: 1, cost: 0.05,   known: 40, unknown: 5 },
  { feature: 'riskBadges',       points: 3,  changed: 0, fallback: 0, failed: 0, cancelled: 0, cost: null,   known: 0,  unknown: 3 },
  { feature: 'guardedMode',      points: 2,  changed: 1, fallback: 1, failed: 0, cancelled: 0, cost: 0.001,  known: 1,  unknown: 1 },
  { feature: 'smartTitles',      points: 2,  changed: 1, fallback: 0, failed: 0, cancelled: 0, cost: 0.002,  known: 2,  unknown: 0 },
  { feature: 'adaptiveThinking', points: 2,  changed: 1, fallback: 0, failed: 0, cancelled: 0, cost: 0.002,  known: 2,  unknown: 0 },
  { feature: 'largeResults',     points: 2,  changed: 1, fallback: 0, failed: 1, cancelled: 0, cost: 0.004,  known: 2,  unknown: 0 },
  { feature: 'semanticLabels',   points: 2,  changed: 0, fallback: 2, failed: 0, cancelled: 0, cost: null,   known: 0,  unknown: 2 },
  { feature: 'decideTool',       points: 1,  changed: 0, fallback: 0, failed: 0, cancelled: 0, cost: 0.001,  known: 1,  unknown: 0 },
]

const TURNS = [
  { id: 't18', n: 18, label: '整理邮件并把需要跟进的挑出来' },
  { id: 't17', n: 17, label: '把构建日志里的失败原因摘出来' },
  { id: 't16', n: 16, label: '这批客户反馈按主题分一下' },
  { id: 't15', n: 15, label: '帮我看看这个改动风险大不大' },
  { id: 't14', n: 14, label: '先随便聊聊，今天天气不错' },
  { id: 't13', n: 13, label: '把 release notes 重写一遍' },
]

let _id = 0
/** `app` 是 fixture 的简写；契约里的字段名是 `application`。 */
function mk(o) {
  const out = Object.assign({ id: `dp-${(++_id).toString().padStart(3, '0')}`, observations: [] }, o)
  if (out.app) { out.application = out.app; delete out.app }
  return out
}

const ITEMS = [
  /* —— 已改变（4） —— */
  mk({ feature: 'smartTitles', turn: 't18', at: '2026-10-09T14:44:53', status: 'changed',
    rec: { action: 'refresh_title' }, app: { action: 'refresh_title', status: 'applied', changed: true, reason: 'topic_shift' },
    obs: [{ key: 'title_regenerated' }],
    attempts: [{ provider: 'typesafe', model: 'jev-1.13', status: 'succeeded', latencyMs: 412, costUsd: 0.0002, inputTokens: 9, outputTokens: 4 }],
    source: { messageId: 'msg-8f21', turnId: 't18' } }),

  mk({ feature: 'guardedMode', turn: 't18', at: '2026-10-09T14:45:10', status: 'changed',
    rec: { action: 'prompt', detail: { risk: 'delete', confidence: 0.91, threshold: 0.8 } },
    app: { action: 'allow', status: 'applied', changed: true, baseline: 'allow', reason: 'risk_below_threshold' },
    obs: [{ key: 'corrected_next' }],
    attempts: [{ provider: 'typesafe', model: 'jev-1.13', status: 'succeeded', latencyMs: 268, costUsd: 0.0004, inputTokens: 12, outputTokens: 3 }],
    source: { messageId: 'msg-8f22', turnId: 't18', toolCallId: 'call-3a91' } }),

  mk({ feature: 'adaptiveThinking', turn: 't17', at: '2026-10-09T14:02:31', status: 'changed',
    rec: { action: 'thinking', actionValue: 'medium', detail: { level: 'medium', confidence: 0.77 } },
    app: { action: 'thinking', actionValue: 'medium', status: 'applied', changed: true, baseline: 'high' },
    obs: [],
    attempts: [{ provider: 'typesafe', model: 'jev-1.13', status: 'succeeded', latencyMs: 331, costUsd: 0.001, inputTokens: 21, outputTokens: 2 }],
    source: { messageId: 'msg-8e04', turnId: 't17' } }),

  mk({ feature: 'largeResults', turn: 't17', at: '2026-10-09T14:03:02', status: 'changed',
    rec: { action: 'filter', detail: { chunks: 6, kept: 3, ratio: 0.18 } },
    app: { action: 'filter', status: 'applied', changed: true, baseline: 'summary' },
    obs: [{ key: 'original_opened' }],
    attempts: [{ provider: 'typesafe', model: 'jev-1.13', status: 'succeeded', latencyMs: 940, costUsd: 0.002, inputTokens: 64, outputTokens: 18 },
               { provider: 'typesafe', model: 'jev-1.13', status: 'succeeded', latencyMs: 812, costUsd: 0.002, inputTokens: 58, outputTokens: 15 }],
    source: { messageId: 'msg-8e10', turnId: 't17', toolCallId: 'call-3a55' } }),

  /* —— 回退（4） —— */
  mk({ feature: 'guardedMode', turn: 't18', at: '2026-10-09T14:46:40', status: 'fallback',
    unavailableReason: 'model_unavailable',
    attempts: [{ provider: 'typesafe', model: 'jev-1.13', status: 'failed', latencyMs: 1820, inputTokens: 11 },
               { provider: 'typesafe', model: 'jev-1.13', status: 'timeout', latencyMs: 3000, inputTokens: 11 }],
    app: { action: 'prompt', status: 'fallback', changed: false, reason: 'model_unavailable' },
    source: { messageId: 'msg-8f30', turnId: 't18', toolCallId: 'call-3b02' } }),

  mk({ feature: 'semanticLabels', turn: 't16', at: '2026-10-09T13:20:11', status: 'fallback',
    rec: { action: 'labels', detail: { matched: 0, confidence: 0.42, threshold: 0.9 } },
    app: { action: 'labels', status: 'fallback', changed: false, reason: 'no_rule_matched' },
    attempts: [{ provider: 'typesafe', model: 'jev-1.13', status: 'succeeded', latencyMs: 355, inputTokens: 14, outputTokens: 2 }],
    source: { messageId: 'msg-8d02', turnId: 't16' } }),

  mk({ feature: 'semanticLabels', turn: 't16', at: '2026-10-09T13:22:48', status: 'fallback',
    rec: { action: 'labels', detail: { matched: 0, confidence: 0.31, threshold: 0.9 } },
    app: { action: 'labels', status: 'fallback', changed: false, reason: 'no_rule_matched' },
    attempts: [{ provider: 'typesafe', model: 'jev-1.13', status: 'succeeded', latencyMs: 300, inputTokens: 14, outputTokens: 2 }],
    source: { messageId: 'msg-8d09', turnId: 't16' } }),

  mk({ feature: 'suggestions', turn: 't15', at: '2026-10-09T12:41:09', status: 'failed',
    unavailableReason: 'over_budget',
    attempts: [{ provider: 'typesafe', model: 'jev-1.13', status: 'failed', latencyMs: 240, inputTokens: 26 }],
    source: { messageId: 'msg-8c11', turnId: 't15' } }),

  /* —— 未确认（3） —— */
  mk({ feature: 'decideTool', turn: 't18', at: '2026-10-09T14:47:12', status: 'unconfirmed',
    rec: { action: 'advice_delivered', detail: { question: 'route', choice: 'billing', probabilities: { billing: 0.82, support: 0.14, other: 0.04 }, confidence: 0.82 } },
    attempts: [{ provider: 'typesafe', model: 'jev-1.13', status: 'succeeded', latencyMs: 168, costUsd: 0.001, inputTokens: 42, outputTokens: 6 }],
    source: { messageId: 'msg-8f41', turnId: 't18', toolCallId: 'call-3b77' } }),

  mk({ feature: 'adaptiveThinking', turn: 't14', at: '2026-10-09T11:02:20', status: 'unconfirmed',
    rec: { action: 'unsure', detail: { confidence: 0.44, threshold: 0.6 } },
    attempts: [{ provider: 'typesafe', model: 'jev-1.13', status: 'succeeded', latencyMs: 402, costUsd: 0.001, inputTokens: 18, outputTokens: 4 }],
    source: { messageId: 'msg-8a10', turnId: 't14' } }),

  mk({ feature: 'suggestions', turn: 't13', at: '2026-10-09T10:15:44', status: 'unconfirmed',
    rec: { action: 'hint_injected', detail: { skill: 'release-notes', score: 0.71 } },
    attempts: [{ provider: 'typesafe', model: 'jev-1.13', status: 'succeeded', latencyMs: 288, costUsd: 0.001, inputTokens: 22, outputTokens: 5 }],
    source: { messageId: 'msg-8a01', turnId: 't13' } }),

  /* —— 失败（3） —— */
  mk({ feature: 'largeResults', turn: 't17', at: '2026-10-09T14:05:50', status: 'failed',
    unavailableReason: 'timed_out',
    attempts: [{ provider: 'typesafe', model: 'jev-1.13', status: 'timeout', latencyMs: 3000, inputTokens: 71 }],
    app: { action: 'skip_summary', status: 'fallback', changed: false, reason: 'timed_out' },
    source: { messageId: 'msg-8e22', turnId: 't17', toolCallId: 'call-3a60' } }),

  mk({ feature: 'suggestions', turn: 't16', at: '2026-10-09T13:24:02', status: 'failed',
    unavailableReason: 'not_configured',
    attempts: [{ provider: 'typesafe', model: 'jev-1.13', status: 'failed', latencyMs: 12 }],
    source: { messageId: 'msg-8d14', turnId: 't16' } }),

  mk({ feature: 'suggestions', turn: 't15', at: '2026-10-09T12:44:31', status: 'failed',
    unavailableReason: 'model_unavailable',
    attempts: [{ provider: 'typesafe', model: 'jev-1.13', status: 'failed', latencyMs: 1904, inputTokens: 24 }],
    source: { messageId: 'msg-8c20', turnId: 't15' } }),

  /* —— 取消（1） —— */
  mk({ feature: 'suggestions', turn: 't14', at: '2026-10-09T11:05:12', status: 'cancelled',
    unavailableReason: 'cancelled_by_user',
    attempts: [{ provider: 'typesafe', model: 'jev-1.13', status: 'cancelled', latencyMs: 640, inputTokens: 17, outputTokens: 1 }],
    source: { messageId: 'msg-8a22', turnId: 't14' } }),

  /* —— 历史记录（旧日志，无事项归属） —— */
  mk({ feature: 'smartTitles', turn: null, at: '2026-10-08T18:20:00', status: 'historical', legacy: true,
    attempts: [{ provider: 'typesafe', model: 'jev-1.12', status: 'succeeded', latencyMs: 380 }] }),

  /* —— 未改变 / 已应用（抽样 4 条；剩余 40 条由 fillers 补齐） —— */
  mk({ feature: 'riskBadges', turn: 't18', at: '2026-10-09T14:45:12', status: 'applied',
    rec: { action: 'badges', detail: { badges: ['delete', 'credentials'], confidence: 0.88 } },
    app: { action: 'badges', status: 'applied', changed: false, reason: 'informational_only' },
    obs: [{ key: 'corrected_next' }],
    attempts: [{ provider: 'typesafe', model: 'jev-1.13', status: 'succeeded', latencyMs: 205, costUsd: 0.0003, inputTokens: 19, outputTokens: 3 }],
    source: { messageId: 'msg-8f23', turnId: 't18', toolCallId: 'call-3a91' } }),

  mk({ feature: 'smartTitles', turn: 't18', at: '2026-10-09T14:41:02', status: 'applied',
    rec: { action: 'keep_title' },
    app: { action: 'keep_title', status: 'applied', changed: false, reason: 'title_fresh' },
    obs: [{ key: 'title_regenerated' }],
    attempts: [{ provider: 'typesafe', model: 'jev-1.13', status: 'succeeded', latencyMs: 402, costUsd: 0.0002, inputTokens: 9, outputTokens: 2 }],
    source: { messageId: 'msg-8f10', turnId: 't18' } }),

  mk({ feature: 'riskBadges', turn: 't15', at: '2026-10-09T12:40:00', status: 'unchanged',
    rec: { action: 'badges', detail: { badges: ['publish'], confidence: 0.74 } },
    app: { action: 'badges', status: 'unchanged', changed: false },
    attempts: [{ provider: 'typesafe', model: 'jev-1.13', status: 'succeeded', latencyMs: 232, inputTokens: 18, outputTokens: 4 }],
    source: { messageId: 'msg-8c02', turnId: 't15' } }),

  mk({ feature: 'riskBadges', turn: 't13', at: '2026-10-09T10:18:22', status: 'unchanged',
    rec: { action: 'badges', detail: { badges: [], confidence: 0.52 } },
    app: { action: 'none', status: 'unchanged', changed: false },
    attempts: [{ provider: 'typesafe', model: 'jev-1.13', status: 'succeeded', latencyMs: 190, inputTokens: 16, outputTokens: 2 }],
    source: { messageId: 'msg-8a05', turnId: 't13' } }),
]

/* 40 条合并进「技能和数据源建议」，让 45 这个数字是真的，也让分页是真的。 */
const FILLERS = Array.from({ length: 40 }, (_, i) => {
  const day = 8 - Math.floor(i / 8)
  const hh = String(17 - (i % 8) * 2).padStart(2, '0')
  const mm = String((i * 7) % 60).padStart(2, '0')
  const injected = i % 3 === 0
  return mk({
    feature: 'suggestions',
    turn: TURNS[5 - (i % 5)].id,
    at: `2026-10-${String(day).padStart(2, '0')}T${hh}:${mm}:00`,
    status: injected ? 'applied' : 'unchanged',
    rec: { action: injected ? 'hint_injected' : 'default', detail: { score: Number((0.4 + (i % 9) * 0.06).toFixed(2)) } },
    app: { action: injected ? 'hint_injected' : 'default', status: injected ? 'applied' : 'unchanged', changed: false },
    observations: i % 7 === 0 ? [{ key: 'source_activated' }] : [],
    attempts: [{ provider: 'typesafe', model: 'jev-1.13', status: 'succeeded', latencyMs: 180 + (i % 11) * 24, costUsd: 0.0011, inputTokens: 20 + (i % 6), outputTokens: 3 }],
    source: { messageId: `msg-7${String(i).padStart(3, '0')}`, turnId: TURNS[5 - (i % 5)].id },
  })
}).filter(() => true)

const ALL_ITEMS = [...ITEMS, ...FILLERS].sort((a, b) => b.at.localeCompare(a.at))

/* ── state ────────────────────────────────────────────────────────────────── */
const S = {
  dir: 'A', lang: 'zh-Hans', theme: 'light', width: 420, state: 'ready',
  feature: '', status: '', turn: '', q: '',
  /* 默认不预选：列表才是落点，详情由用户点出来。 */
  selected: null,
  open: new Set([ITEMS.find(i => i.feature === 'smartTitles' && i.status === 'changed')?.id || ITEMS[0].id]),
  sort: 'time', sortDir: 'desc', drawer: false, shown: 14, legacyStatus: false,
  featureOpen: false, matrixOpen: undefined,
}

/* ── helpers ──────────────────────────────────────────────────────────────── */
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const L = (pair) => (S.lang === 'zh-Hans' ? pair[0] : pair[1])
function t(key, vars) {
  const pair = T[key]
  let out = pair ? L(pair) : key
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{{${k}}}`, String(v))
  return out
}
function tPlural(base, count, vars) {
  const key = count === 1 && T[`${base}_one`] ? `${base}_one` : base
  return t(key, { count, ...(vars || {}) })
}
const featureName = (k) => (FEATURES[k] ? L([FEATURES[k].zh, FEATURES[k].en]) : k)
const featureIcon = (k) => (FEATURES[k] ? FEATURES[k].icon : 'info')
function actionName(it) {
  const a = it.rec?.action || it.application?.action
  if (!a) return null
  const pair = ACTION[a]
  if (!pair) return a
  return L(pair).replace('{{value}}', it.rec?.actionValue ?? it.application?.actionValue ?? '')
}
function appActionName(it) {
  const a = it.application?.action
  if (!a) return null
  const pair = ACTION[a]
  if (!pair) return a
  return L(pair).replace('{{value}}', it.application?.actionValue ?? '')
}
const reasonName = (r) => (r && REASON[r] ? L(REASON[r]) : r || null)
const obsName = (o) => (o && OBS[o.key] ? L(OBS[o.key]) : o?.key || '')

/** 费用格式与现有实现一致：≥$0.01 两位，否则四位；未知绝不当成 $0.00。 */
function fmtCost(v) {
  if (v === null || v === undefined) return null
  return `$${v.toFixed(v < 0.01 ? 4 : 2)}`
}
const fmtNum = (n) => n.toLocaleString(S.lang === 'zh-Hans' ? 'zh-Hans' : 'en')

const _timeFmt = () => new Intl.DateTimeFormat(S.lang === 'zh-Hans' ? 'zh-Hans' : 'en', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
})
const fmtTime = (iso) => _timeFmt().format(new Date(iso))

function statusTag(status, extra = '') {
  const meta = STATUS[status] || STATUS.unconfirmed
  const key = `trajectory.decisions.status.${status}`
  /* legacyStatus = 当前实现的真实行为：status.applied 这个键不存在，i18next
     会原样把键名渲染出来。这里刻意复现，方便对照。 */
  const raw = S.legacyStatus && status === 'applied'
  const label = raw ? key : T[key] ? t(key) : status
  const dot = raw ? '' : `<span class="dot ${meta.shape === 'ring' ? 'is-ring' : ''}"></span>`
  return `<span class="tag tone-${meta.tone} ${extra}"${raw ? ' title="i18n 键缺失，界面漏出键名"' : ''}>${dot}${esc(label)}</span>`
}
function costTag(count, total, known, unknown) {
  const c = fmtCost(total)
  if (!known) return `<span class="tag tone-warn">${esc(t('runD.unknown'))}${unknown ? ` ×${unknown}` : ''}</span>`
  return `${esc(c)}${unknown ? ` <span class="tag tone-warn">${esc(t('runD.unknownPill', { n: unknown }))}</span>` : ''}`
}

function turnLabel(id) {
  const turn = TURNS.find(x => x.id === id)
  return turn ? t('runD.turnN', { n: turn.n }) : t('runD.sessionLevel')
}

/* ── filtering ────────────────────────────────────────────────────────────── */
function filtered() {
  let list = ALL_ITEMS
  if (S.feature) list = list.filter(i => i.feature === S.feature)
  if (S.status) list = list.filter(i => itemStatus(i) === S.status)
  if (S.turn) list = list.filter(i => (i.turn || '') === S.turn)
  if (S.q.trim()) {
    const q = S.q.trim().toLowerCase()
    list = list.filter(i => [featureName(i.feature), actionName(i), appActionName(i), i.id]
      .filter(Boolean).join(' ').toLowerCase().includes(q))
  }
  return list
}
const isFiltered = () => !!(S.feature || S.status || S.turn || S.q.trim())
const selectedItem = () => ALL_ITEMS.find(i => i.id === S.selected) || null

/* ── shared blocks ────────────────────────────────────────────────────────── */

/** 指标瓷砖：完全照搬 Run → 概览的写法
 *  `grid grid-cols-2 gap-2 @min-[760px]/trajectory:grid-cols-4`
 *  + `rounded-lg bg-foreground/[0.025] px-3 py-2.5`
 *  + 标签 11px medium 带 14px 图标，数值 16px semibold tabular。 */
function tilesBlock(opts = {}) {
  const T_ = TOTALS
  const unchanged = ALL_ITEMS.filter(i => itemStatus(i) === 'unchanged').length
  const cells = [
    { k: 'points', icon: 'corner-down-right', v: fmtNum(T_.points), sub: `${fmtNum(unchanged)} ${L(['保持原样', 'unchanged'])}` },
    { k: 'changed', icon: 'arrow-right', v: fmtNum(T_.changed), sub: L(['相对当时基线', 'against the baseline then']) },
    { k: 'fallback', icon: 'ban', v: fmtNum(T_.fallback), sub: L(['含超时与不可达', 'timeouts and unreachable']) },
    { k: 'cost', icon: 'clock', v: fmtCost(T_.knownCostUsd), sub: null },
  ]
  const inner = cells.map(c => `
    <div class="tile">
      <dt>${svg(c.icon, 'ic')}${esc(t(`trajectory.decisions.${c.k}`))}</dt>
      <dd>
        <span class="num">${esc(c.v)}</span>
        ${c.k === 'cost' && T_.unknownCostRequests
          ? `<span class="tag tone-warn" title="${esc(t('runD.unknownNote', { n: T_.unknownCostRequests }))}">${esc(t('runD.unknownPill', { n: T_.unknownCostRequests }))}</span>`
          : c.sub ? `<span class="unit">${esc(c.sub)}</span>` : ''}
      </dd>
    </div>`).join('')
  return `<div class="tiles ${opts.two ? 'is-two' : ''}">${inner}</div>`
}

/** 功能分布：Run 的 listbox + 行（图标 + 占比条 + 三列等宽数字），默认折叠到前 4 项。 */
function featureDistribution(opts = {}) {
  const max = Math.max(...FEATURE_TOTALS.map(f => f.points))
  const limit = opts.limit || (S.featureOpen ? FEATURE_TOTALS.length : 4)
  const shown = FEATURE_TOTALS.slice(0, limit)
  const rows = shown.map(f => {
    const known = f.known > 0
    const c = fmtCost(f.cost)
    const costTxt = known
      ? `${esc(c)}${f.unknown ? ` <span class="unk" title="${esc(t('runD.unknownNote', { n: f.unknown }))}">+${f.unknown}?</span>` : ''}`
      : `<span class="unk">${esc(t('runD.unknown'))}${f.unknown ? ` ×${f.unknown}` : ''}</span>`
    return `
    <button type="button" class="fdist-row ${S.feature === f.feature ? 'is-on' : ''}"
            data-act="feature" data-feature="${f.feature}" aria-pressed="${S.feature === f.feature}">
      <span class="ftile">${svg(featureIcon(f.feature))}</span>
      <span class="fdist-main">
        <span class="fdist-name"><span>${esc(featureName(f.feature))}</span>
          ${S.feature === f.feature ? svg('x', 'ic ic-sm') : ''}</span>
        <span class="fdist-bar bar ${f.changed ? '' : 'is-quiet'}"><i style="width:${Math.max(3, (f.points / max) * 100)}%"></i></span>
      </span>
      <span class="fdist-nums">
        <span class="pts">${fmtNum(f.points)}</span>
        <span class="chg">${f.changed ? `${fmtNum(f.changed)} ${L(['改变', 'chg'])}` : ''}</span>
        <span class="cost ${known ? '' : 'is-unknown'}">${costTxt}</span>
      </span>
    </button>`
  }).join('')
  const rest = FEATURE_TOTALS.length - shown.length
  return `<div class="listbox">
    ${rows}
    ${rest > 0
      ? `<button type="button" class="fdist-more" data-act="featureMore">${svg('chevron-down', 'ic ic-sm')}${esc(L([`展开全部 ${FEATURE_TOTALS.length} 项`, `Show all ${FEATURE_TOTALS.length} features`]))}</button>`
      : S.featureOpen ? `<button type="button" class="fdist-more is-open" data-act="featureMore">${svg('chevron-down', 'ic ic-sm')}${esc(L(['收起', 'Collapse']))}</button>` : ''}
  </div>
  <p class="legend">${esc(L(['三项数字依次为：事项 · 已改变 · 开销。', 'Numbers are points · changed · cost.']))} <b>+n?</b> ${esc(L(['表示 n 次请求未报告费用', 'means n requests reported no cost']))}</p>`
}

/** 工具栏：照搬 TrajectoryToolbar —— 24px 按钮 / 6px 圆角 / 11px 字号 /
 *  分隔线 1×16px / 搜索框 26px 圆角 7px 弹性 164px / 计数 11px tabular。 */
function toolbar(opts = {}) {
  const counts = Object.fromEntries(['changed', 'applied', 'fallback', 'failed', 'cancelled'].map(s =>
    [s, ALL_ITEMS.filter(i => itemStatus(i) === s).length]))
  const statuses = ['changed', 'applied', 'fallback', 'failed', 'cancelled']
  const buttons = statuses.map(s => `
    <button type="button" class="tb-filter" data-act="status" data-status="${s}" aria-pressed="${S.status === s}">
      ${esc(t(`trajectory.decisions.status.${s}`))}<span class="n">${counts[s]}</span>
    </button>`).join('')
  const total = filtered().length
  const usedTurns = [...new Set(ALL_ITEMS.map(i => i.turn).filter(Boolean))].filter(id => TURNS.some(x => x.id === id))
  const counter = isFiltered()
    ? t('runD.count', { shown: fmtNum(total), total: fmtNum(ALL_ITEMS.length) })
    : L([`${fmtNum(total)} 条`, `${fmtNum(total)} records`])
  return `
  <div class="tb">
    <div class="tb-filters">
      <button type="button" class="tb-filter" data-act="clearAll" aria-pressed="${!isFiltered()}">${esc(t('runD.flat'))}</button>
      ${buttons}
      ${isFiltered() ? `<button type="button" class="tb-filter" data-act="clear">${svg('x', 'ic ic-sm')}${esc(t('runD.clear'))}</button>` : ''}
    </div>
    ${usedTurns.length ? `<span class="tb-divider"></span><span class="tb-selectwrap">
      <select class="tb-select" data-act="turn" aria-label="${esc(t('trajectory.decisions.turn'))}">
        <option value="">${esc(t('trajectory.decisions.allTurns'))}</option>
        ${usedTurns.map(id => `<option value="${id}" ${S.turn === id ? 'selected' : ''}>${esc(turnLabel(id))}</option>`).join('')}
      </select></span>` : ''}
    <span class="tb-count">${esc(counter)}</span>
    <label class="tb-search">${svg('search', 'ic ic-sm')}
      <input type="search" data-act="q" value="${esc(S.q)}" placeholder="${esc(t('runD.search'))}" aria-label="${esc(t('runD.search'))}">
    </label>
  </div>`
}

/** 记录行：Run 的行语言（12px 主行 + 11px 次行、turn-chip、等宽金额、3px 状态轨）。 */
function recordRow(it, mode = 'rec') {
  const st = S.legacyStatus ? itemStatusLegacy(it) : itemStatus(it)
  const on = mode === 'rec' ? S.selected === it.id : S.open.has(it.id)
  const cost = it.attempts.reduce((sum, a) => sum + (a.costUsd || 0), 0)
  const known = it.attempts.some(a => a.costUsd !== undefined)
  const unknown = it.attempts.some(a => a.costUsd === undefined)
  const title = actionName(it) || appActionName(it) || featureName(it.feature)
  const money = `<span class="rec-cost ${known ? '' : 'is-unknown'}">${known ? esc(fmtCost(cost)) : esc(t('runD.unknown'))}${known && unknown ? ' +?' : ''}</span>`

  /* 行内只保留扫读需要的信息：轮次 / 功能 / 时间。
     请求次数与耗时属于诊断信息，放在详情里，不挤占列表的横向空间。 */
  const sub = [
    `<span class="turn-chip">${esc(it.turn ? turnLabel(it.turn) : t('runD.sessionLevel'))}</span>`,
    `<span>${esc(featureName(it.feature))}</span>`,
    `<span>${esc(fmtTime(it.at))}</span>`,
  ].join('<span class="sep">·</span>')

  if (mode === 'rec') {
    return `
    <button type="button" class="rec ${on ? 'is-on' : ''}" data-act="select" data-id="${it.id}"
            aria-current="${on}" data-status="${st}">
      <span class="ftile">${svg(featureIcon(it.feature))}</span>
      <span class="rec-main">
        <span class="rec-title">${esc(title)}</span>
        <span class="rec-sub">${sub}</span>
      </span>
      <span class="rec-side">${statusTag(st)}${money}</span>
    </button>`
  }
  return `
  <button type="button" class="node-btn" data-act="toggle" data-id="${it.id}"
          aria-expanded="${on}" data-status="${st}">
    <span class="node-dot tone-${STATUS[st]?.tone === 'business-quiet' ? 'business' : STATUS[st]?.tone || 'neutral'} ${STATUS[st]?.shape === 'ring' ? 'is-ring' : ''} ${STATUS[st]?.pulse ? 'is-pulse' : ''}"></span>
    <span class="node-body">
      <span class="node-title"><span>${esc(title)}</span></span>
      <span class="node-sub">${sub}</span>
    </span>
    <span class="node-side">${statusTag(st)}${money}</span>
  </button>`
}

/** 记录详情 —— 三个方向共用同一个组件，这是「一套系统」的证明。
 *  版式照搬 Run → 概览：分区标题 12px semibold；事实用 `.kv`（标签左、值右，
 *  ≥620px 双列）；请求明细用 `.card`；原始记录退到折叠里。 */
function detailBlock(it) {
  if (!it) return ''
  const st = S.legacyStatus ? itemStatusLegacy(it) : itemStatus(it)
  const rec = it.rec, app = it.application

  const kv = (rows) => {
    const clean = rows.filter(Boolean)
    if (!clean.length) return ''
    return `<dl class="kv">${clean.map(([k, v, mono]) =>
      `<div class="kv-row"><dt>${esc(k)}</dt><dd class="${mono ? 'mono' : ''}" title="${esc(String(v).replace(/<[^>]*>/g, ''))}">${v}</dd></div>`).join('')}</dl>`
  }

  const srcRows = it.source ? [
    it.source.turnId ? [t('trajectory.decisions.turn'), esc(turnLabel(it.source.turnId))] : null,
    it.source.messageId ? [L(['消息', 'Message']), esc(it.source.messageId), true] : null,
    it.source.toolCallId ? [L(['工具调用', 'Tool call']), esc(it.source.toolCallId), true] : null,
    it.source.runOperationId ? [L(['运行操作', 'Run operation']), esc(it.source.runOperationId), true] : null,
  ].filter(Boolean) : []

  const triggerSec = `
  <section class="dtl-sec">
    <h4>${esc(t('trajectory.decisions.trigger'))}</h4>
    ${srcRows.length ? kv(srcRows) : `<p class="sub-line">${esc(t('trajectory.decisions.triggerUnknown'))}</p>`}
    ${it.unavailableReason ? `<div class="note is-info" style="margin-top:8px">${svg('info', 'ic ic-sm')}<span>${esc(t('trajectory.decisions.unavailableReason', { reason: reasonName(it.unavailableReason) }))}</span></div>` : ''}
  </section>`

  const recSec = `
  <section class="dtl-sec">
    <h4>${esc(t('trajectory.decisions.recommendation'))}</h4>
    ${rec
      ? `<p class="action-line">${esc(actionName(it))}</p>
         ${rec.detail?.confidence !== undefined ? `<p class="sub-line" style="margin-top:4px">${esc(t('runD.confidence'))} ${rec.detail.confidence.toFixed(2)}${rec.detail.threshold !== undefined ? ` · ${L(['阈值', 'threshold'])} ${rec.detail.threshold}` : ''}</p>` : ''}
         <details class="ev"><summary>${esc(t('trajectory.decisions.structuredEvidence'))}</summary>
           <div class="ev-body">${kv(Object.entries(rec.detail || {}).map(([k, v]) => [k, esc(typeof v === 'object' ? JSON.stringify(v) : String(v)), typeof v !== 'object']))}</div>
         </details>`
      : `<p class="action-line is-quiet">${esc(t('trajectory.decisions.noRecommendation'))}</p>`}
  </section>`

  const appSec = `
  <section class="dtl-sec">
    <h4>${esc(t('trajectory.decisions.application'))} ${statusTag(st)}</h4>
    ${app
      ? `<p class="action-line">${esc(appActionName(it))}</p>
         ${kv([
            app.baseline ? [t('runD.baseline'), esc(app.baseline)] : null,
            app.reason ? [t('runD.reason'), esc(reasonName(app.reason))] : null,
          ]) || '<div style="height:8px"></div>'}
         ${app.detail ? `<details class="ev"><summary>${esc(t('trajectory.decisions.structuredEvidence'))}</summary>
           <div class="ev-body">${kv(Object.entries(app.detail).map(([k, v]) => [k, esc(String(v))]))}</div></details>` : ''}`
      : `<div class="note">${svg('info', 'ic ic-sm')}<span>${esc(t('trajectory.decisions.applicationUnknown'))}</span></div>`}
  </section>`

  const obsSec = `
  <section class="dtl-sec">
    <h4>${esc(t('trajectory.decisions.observations'))}</h4>
    ${it.observations.length
      ? `<div class="listbox">${it.observations.map(o =>
          `<div class="lrow" style="grid-template-columns:14px minmax(0,1fr);min-height:32px;font-size:11px">${svg('corner-down-right', 'ic ic-sm')}<span>${esc(obsName(o))}</span></div>`).join('')}</div>`
      : `<p class="sub-line">${esc(t('trajectory.decisions.noObservations'))}</p>`}
  </section>`

  const attempts = it.attempts.map(a => {
    const costTxt = a.costUsd === undefined ? t('runD.unknown') : fmtCost(a.costUsd)
    const tone = a.status === 'failed' || a.status === 'timeout' ? 'error'
      : a.status === 'cancelled' ? 'neutral'
        : a.status === 'pending' ? 'business' : 'neutral'
    return `
    <div class="card">
      <div style="display:flex;align-items:center;gap:8px;min-width:0">
        <span class="tag tone-${tone}"><span class="dot"></span>${esc(t(`trajectory.decisions.attempt.${a.status}`))}</span>
        <span style="font:11px/14px var(--font-mono);color:var(--label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.model)}</span>
        <span style="margin-left:auto;display:flex;align-items:center;gap:10px;flex:none">
          <span style="font:10px/14px var(--font-mono);color:var(--label-tertiary)">${a.latencyMs} ms</span>
          <span style="font:10px/14px var(--font-mono);color:${a.costUsd === undefined ? 'var(--info-text)' : 'var(--label-tertiary)'}">${esc(costTxt)}</span>
        </span>
      </div>
      <div style="margin-top:8px">
        ${kv([
          [t('runD.tokens'), `${a.inputTokens ?? '—'} / ${a.outputTokens ?? '—'}`],
          [L(['服务', 'Provider']), esc(a.provider), true],
        ])}
      </div>
    </div>`
  }).join('')

  const reqSec = `
  <section class="dtl-sec">
    <h4>${esc(t('trajectory.decisions.requests'))}<span class="n">· ${it.attempts.length}</span></h4>
    ${attempts}
    <p class="note-line" style="margin-top:8px">${esc(t('trajectory.decisions.privacy'))}</p>
    <details class="ev"><summary>${esc(t('runD.raw'))}</summary>
      <div class="ev-body"><pre>${esc(JSON.stringify({
        id: it.id, feature: it.feature, startedAt: it.at, legacy: !!it.legacy,
        source: it.source ?? null, unavailableReason: it.unavailableReason ?? null,
      }, null, 2))}</pre></div>
    </details>
  </section>`

  return `<div style="display:flex;flex-direction:column;gap:16px">${triggerSec}${recSec}${appSec}${obsSec}${reqSec}</div>`
}

function detailHeader(it, onBack) {
  const st = S.legacyStatus ? itemStatusLegacy(it) : itemStatus(it)
  return `
  <div class="dtl-head">
    ${onBack ? `<button type="button" class="btn btn-icon btn-ghost" data-act="back" aria-label="${esc(t('runD.back'))}">${svg('arrow-left')}</button>` : ''}
    <span class="ftile" style="width:22px;height:22px">${svg(featureIcon(it.feature))}</span>
    <span class="grow">
      <h3>${esc(actionName(it) || featureName(it.feature))}</h3>
      <span class="sub">${esc(featureName(it.feature))} · ${esc(fmtTime(it.at))} · ${esc(turnLabel(it.turn))}</span>
    </span>
    ${statusTag(st, 'tag-lg')}
  </div>`
}

/* ── Direction A · 台账 Ledger ────────────────────────────────────────────── */
/** 状态行 —— 照搬 Run → 概览的 `flex items-center gap-2 border-b border-border/50 pb-3`：
 *  状态点 + 13px semibold 标题 + 11px tabular 右侧元信息。 */
function statusHeader(extra) {
  return `
  <div class="status-row">
    <span class="status-dot"></span>
    <h2>${esc(t('trajectory.decisions.title'))}</h2>
    ${REPORT.coverage === 'partial' ? `<span class="tag tone-warn">${esc(L(['覆盖不完整', 'Partial coverage']))}</span>` : ''}
    ${S.state === 'disabled' ? `<span class="tag tone-neutral">${esc(L(['当前已关闭', 'Currently off']))}</span>` : ''}
    <span class="meta">${esc(extra)}</span>
    <span class="tb-divider"></span>
    <button type="button" class="action-link" data-act="config">${svg('settings', 'ic ic-sm')}${esc(t('trajectory.decisions.configure'))}</button>
  </div>`
}

function accountingNote() {
  return `<p class="note-line">${esc(t('trajectory.decisions.accounting', {
    requests: fmtNum(TOTALS.requests), unconfirmed: TOTALS.unconfirmed, failures: TOTALS.failures,
    cancelled: TOTALS.cancelled, input: fmtNum(TOTALS.inputTokens), output: fmtNum(TOTALS.outputTokens),
  }))} ${esc(t('trajectory.decisions.includedCost'))}${
    TOTALS.legacyCalls ? `<br>${esc(tPlural('trajectory.decisions.legacyCalls', TOTALS.legacyCalls))}` : ''
  }${S.state === 'disabled' ? `<br>${esc(t('trajectory.decisions.disabled'))}` : ''}</p>`
}

function renderA() {
  const items = filtered().slice(0, S.shown)
  const total = filtered().length
  const it = selectedItem()
  const narrow = S.width < 720
  const rows = items.map(i => recordRow(i, 'rec')).join('')

  return `
  <div class="a-root ${it ? 'is-detail' : ''}">
    <div class="a-head">
      ${statusHeader(L([`${FEATURE_TOTALS.length} 项功能 · ${fmtNum(TOTALS.requests)} 次请求`, `${FEATURE_TOTALS.length} features · ${fmtNum(TOTALS.requests)} requests`]))}
      ${tilesBlock()}
      ${accountingNote()}
    </div>
    <div class="a-body">
      <div class="a-list">
        ${toolbar()}
        <div class="a-list-scroll">
          <div class="a-list-inner">
            <section class="section">
              <div class="section-head"><h3>${esc(t('trajectory.decisions.features'))}</h3><span class="n">${FEATURE_TOTALS.length}</span></div>
              ${featureDistribution()}
            </section>
            <section class="section">
              <div class="section-head"><h3>${esc(t('trajectory.decisions.records'))}</h3><span class="n">${fmtNum(total)}</span></div>
              <div class="listbox">${rows}</div>
              ${items.length === 0 ? renderInlineEmpty() : ''}
              ${total > items.length ? `<div class="load-more"><button type="button" class="btn" data-act="more">${esc(t('runD.showMore', { n: fmtNum(total - items.length) }))}</button></div>` : ''}
            </section>
          </div>
        </div>
      </div>
      <div class="a-detail">
        ${it ? `<div class="dtl">
          ${detailHeader(it, narrow)}
          <div class="dtl-body">${detailBlock(it)}</div>
        </div>` : `<div class="dtl-idle">
          <span class="state-icon">${svg('list-tree', 'ic ic-lg')}</span>
          <h3>${esc(t('runD.selectHint'))}</h3>
          <p class="sub-line">${esc(t('runD.selectHintSub'))}</p>
        </div>`}
      </div>
    </div>
  </div>`
}

/* ── Direction B · 时间流 Stream ──────────────────────────────────────────── */
function renderB() {
  const list = filtered().slice(0, S.shown)
  const total = filtered().length
  const groups = []
  for (const it of list) {
    const key = it.turn || '__none'
    let g = groups.find(x => x.key === key)
    if (!g) { g = { key, items: [] }; groups.push(g) }
    g.items.push(it)
  }
  const blocks = groups.map(g => {
    const turn = TURNS.find(x => x.id === g.key)
    const changed = g.items.filter(i => ['changed', 'applied'].includes(itemStatus(i))).length
    return `
    <section class="section">
      <header class="turn-head">
        <span class="t">${esc(turn ? t('runD.turnN', { n: turn.n }) : t('runD.sessionLevel'))}</span>
        ${turn ? `<span class="note-line">${esc(turn.label)}</span>` : ''}
        <span class="meta">${g.items.length} ${L(['项', 'points'])}${changed ? ` · ${changed} ${L(['已应用', 'applied'])}` : ''}</span>
      </header>
      <div class="stream">
        ${g.items.map(it => `
          <div class="node">
            ${recordRow(it, 'node')}
            ${S.open.has(it.id) ? `<div class="node-panel">${detailBlock(it)}
              <div style="display:flex;gap:8px">
                ${it.source?.messageId ? `<button type="button" class="btn btn-accent" data-act="chat">${svg('external-link', 'ic ic-sm')}${esc(t('trajectory.decisions.openChat'))}</button>` : ''}
                <button type="button" class="btn btn-ghost" data-act="locate">${svg('activity', 'ic ic-sm')}${esc(t('runD.locate'))}</button>
              </div></div>` : ''}
          </div>`).join('')}
      </div>
    </section>`
  }).join('')

  return `
  <div class="b-root">
    <div class="b-head" id="bHead">
      ${statusHeader(L([`${FEATURE_TOTALS.length} 项功能 · ${fmtNum(TOTALS.requests)} 次请求`, `${FEATURE_TOTALS.length} features · ${fmtNum(TOTALS.requests)} requests`]))}
      <div class="b-summary">
        <span class="cell"><span class="num">${fmtNum(TOTALS.points)}</span><span class="lbl">${esc(t('trajectory.decisions.points'))}</span></span>
        <span class="cell"><span class="num">${fmtNum(TOTALS.changed)}</span><span class="lbl">${esc(t('trajectory.decisions.changed'))}</span></span>
        <span class="cell"><span class="num">${fmtNum(TOTALS.fallback)}</span><span class="lbl">${esc(t('trajectory.decisions.fallback'))}</span></span>
        <span class="cell"><span class="num">${esc(fmtCost(TOTALS.knownCostUsd))}</span>
          <span class="tag tone-warn">${esc(t('runD.unknownPill', { n: TOTALS.unknownCostRequests }))}</span></span>
      </div>
      <p class="note-line b-note">${esc(L(['按轮次分组，越新的越靠上。点击任意一条就地展开判断、处理与请求明细。',
        'Grouped by turn, newest first. Click any row to expand its recommendation, handling and requests in place.']))}</p>
      <div class="b-features">${featureDistribution()}</div>
      ${toolbar()}
    </div>
    <div class="b-scroll">
      <div class="b-inner">
        ${blocks || renderInlineEmpty()}
        ${total > list.length ? `<div class="load-more"><button type="button" class="btn" data-act="more">${esc(t('runD.showMore', { n: fmtNum(total - list.length) }))}</button></div>` : ''}
      </div>
    </div>
  </div>`
}

/* ── Direction C · 决策板 Board ─────────────────────────────────────────────
   与 Run 其余标签页一致的读法：状态行 → 指标瓷砖 → 分区（功能对比 → 决策记录）。
   不再有内嵌的第二层标签条 —— Run 已经有一层标签，套两层会让人不知道自己在哪。 */
function renderC() {
  const list = filtered().slice(0, S.shown)
  const total = filtered().length
  const it = selectedItem()
  const wide = S.width >= 760
  const max = Math.max(...FEATURE_TOTALS.map(f => f.points))
  const matrixOpen = S.matrixOpen === undefined ? wide : S.matrixOpen

  const matrixRows = FEATURE_TOTALS.map(f => `
    <tr data-act="feature" data-feature="${f.feature}" aria-selected="${S.feature === f.feature}" tabindex="0">
      <td class="name"><span class="name-in"><span class="ftile ftile-sm">${svg(featureIcon(f.feature))}</span><span>${esc(featureName(f.feature))}</span></span></td>
      <td class="num">${fmtNum(f.points)}</td>
      <td class="num ${f.changed ? '' : 'zero'}">${fmtNum(f.changed)}</td>
      <td class="num ${f.fallback ? '' : 'zero'}">${fmtNum(f.fallback)}</td>
      <td class="num ${f.failed ? '' : 'zero'}">${fmtNum(f.failed)}</td>
      <td><span class="bar ${f.changed ? '' : 'is-quiet'}"><i style="width:${Math.max(3, (f.points / max) * 100)}%"></i></span></td>
      <td class="num money">${costTag(f.points, f.cost, f.known, f.unknown)}</td>
    </tr>`).join('')

  /* 窄面板：矩阵降级成列表行，和记录列表同一套视觉 */
  const matrixCompact = FEATURE_TOTALS.map(f => `
    <button type="button" class="mrow ${S.feature === f.feature ? 'is-on' : ''}" data-act="feature" data-feature="${f.feature}" aria-pressed="${S.feature === f.feature}">
      <span class="ftile">${svg(featureIcon(f.feature))}</span>
      <span class="mrow-main">
        <span class="mrow-name">${esc(featureName(f.feature))}</span>
        <span class="mrow-sub">${f.changed ? `${fmtNum(f.changed)} ${L(['改变', 'changed'])} · ` : ''}${f.fallback ? `${fmtNum(f.fallback)} ${L(['回退', 'fallback'])} · ` : ''}${f.failed ? `${fmtNum(f.failed)} ${L(['失败', 'failed'])} · ` : ''}${f.known ? esc(fmtCost(f.cost)) : esc(t('runD.unknown'))}${f.unknown ? ` <span style="color:var(--info-text)">+${f.unknown}?</span>` : ''}</span>
      </span>
      <span class="mrow-num">${fmtNum(f.points)}</span>
    </button>`).join('')

  const matrix = wide ? `
    <table class="matrix">
      <thead><tr>
        <th>${esc(t('runD.feature'))}</th>
        <th class="num">${esc(t('trajectory.decisions.points'))}</th>
        <th class="num">${esc(t('trajectory.decisions.changed'))}</th>
        <th class="num">${esc(t('trajectory.decisions.fallback'))}</th>
        <th class="num">${esc(t('trajectory.decisions.status.failed'))}</th>
        <th style="width:96px">${L(['占比', 'Share'])}</th>
        <th class="num">${esc(t('trajectory.decisions.cost'))}</th>
      </tr></thead>
      <tbody>${matrixRows}</tbody>
      <tfoot><tr>
        <td>${esc(t('runD.total'))}</td>
        <td class="num">${fmtNum(TOTALS.points)}</td>
        <td class="num">${fmtNum(TOTALS.changed)}</td>
        <td class="num">${fmtNum(TOTALS.fallback)}</td>
        <td class="num">${fmtNum(TOTALS.failures)}</td>
        <td></td>
        <td class="num money">${esc(fmtCost(TOTALS.knownCostUsd))} <span class="tag tone-warn">${esc(t('runD.unknownPill', { n: TOTALS.unknownCostRequests }))}</span></td>
      </tr></tfoot>
    </table>`
    : `<div class="listbox">${matrixCompact}</div>`

  const recordRows = list.map(i2 => {
    const st = S.legacyStatus ? itemStatusLegacy(i2) : itemStatus(i2)
    const cost = i2.attempts.reduce((s, a) => s + (a.costUsd || 0), 0)
    const known = i2.attempts.some(a => a.costUsd !== undefined)
    return `
    <tr data-act="select" data-id="${i2.id}" aria-selected="${S.selected === i2.id}" tabindex="0" data-status="${st}">
      <td class="time">${esc(fmtTime(i2.at))}</td>
      <td><span class="cellin"><span class="turn-chip">${esc(i2.turn ? turnLabel(i2.turn) : t('runD.sessionLevel'))}</span><span>${esc(featureName(i2.feature))}</span></span></td>
      <td>${esc(actionName(i2) || appActionName(i2) || '—')}</td>
      <td>${statusTag(st)}</td>
      <td class="num money ${known ? '' : 'is-unknown'}">${known ? esc(fmtCost(cost)) : esc(t('runD.unknown'))}</td>
    </tr>`
  }).join('')

  /* 窄面板：表格换成卡片列表，直接复用记录行组件 */
  const records = wide ? `
    <table class="rtable">
      <colgroup>
        <col style="width:90px"><col style="width:176px"><col><col style="width:96px"><col style="width:88px">
      </colgroup>
      <thead><tr>
        <th class="sortable ${S.sort === 'time' ? 'is-sorted' : ''}" data-act="sort" data-sort="time">${esc(t('runD.time'))}<span class="arw">${svg(S.sortDir === 'desc' ? 'chevron-down' : 'chevron-up-down', 'ic ic-sm')}</span></th>
        <th>${esc(t('runD.feature'))}</th>
        <th>${esc(t('runD.action'))}</th>
        <th>${esc(t('runD.outcome'))}</th>
        <th class="num sortable ${S.sort === 'cost' ? 'is-sorted' : ''}" data-act="sort" data-sort="cost">${esc(t('trajectory.decisions.cost'))}<span class="arw">${svg('chevron-up-down', 'ic ic-sm')}</span></th>
      </tr></thead>
      <tbody>${recordRows}</tbody>
    </table>`
    : `<div class="listbox">${list.map(i2 => recordRow(i2, 'rec')).join('')}</div>`

  const drawer = (it && S.drawer) ? `
    <div class="drawer-scrim" data-act="close"></div>
    <aside class="drawer" role="dialog" aria-label="${esc(t('trajectory.decisions.records'))}">
      <div class="drawer-handle"></div>
      <div class="drawer-head">
        <span class="ftile" style="width:22px;height:22px">${svg(featureIcon(it.feature))}</span>
        <span class="grow">
          <h3>${esc(actionName(it) || featureName(it.feature))}</h3>
          <span class="sub">${esc(featureName(it.feature))} · ${esc(fmtTime(it.at))} · ${esc(turnLabel(it.turn))}</span>
        </span>
        ${statusTag((S.legacyStatus ? itemStatusLegacy(it) : itemStatus(it)), 'tag-lg')}
        <button type="button" class="btn btn-icon btn-ghost" data-act="close" aria-label="${esc(L(['关闭', 'Close']))}">${svg('x')}</button>
      </div>
      <div class="drawer-body">${detailBlock(it)}
        <div style="display:flex;gap:8px">
          ${it.source?.messageId ? `<button type="button" class="btn btn-accent" data-act="chat">${svg('external-link', 'ic ic-sm')}${esc(t('trajectory.decisions.openChat'))}</button>` : ''}
          <button type="button" class="btn btn-ghost" data-act="locate">${svg('activity', 'ic ic-sm')}${esc(t('runD.locate'))}</button>
        </div>
      </div>
    </aside>` : ''

  return `
  <div class="c-root">
    <div class="c-scroll">
      <div class="run-inner" style="padding:12px 12px 32px">
        ${statusHeader(L([`${FEATURE_TOTALS.length} 项功能 · ${fmtNum(TOTALS.requests)} 次请求`, `${FEATURE_TOTALS.length} features · ${fmtNum(TOTALS.requests)} requests`]))}
        <div style="display:flex;flex-direction:column;gap:8px">
          ${tilesBlock()}
          ${accountingNote()}
        </div>
        <section class="section">
          <div class="section-head">
            <h3>${esc(t('runD.matrix'))}</h3><span class="n">${FEATURE_TOTALS.length}</span>
            <button type="button" class="action-link" data-act="matrixToggle" aria-expanded="${matrixOpen}">
              ${matrixOpen ? esc(L(['收起', 'Collapse'])) : esc(L(['展开', 'Expand']))}${svg(matrixOpen ? 'chevron-up-down' : 'chevron-down', 'ic ic-sm')}
            </button>
          </div>
          ${matrixOpen ? matrix : ''}
        </section>
        <section class="section">
          <div class="section-head">
            <h3>${esc(t('trajectory.decisions.records'))}</h3><span class="n">${fmtNum(total)}</span>
          </div>
          ${toolbar()}
          ${list.length ? records : renderInlineEmpty()}
          ${total > list.length ? `<div class="load-more"><button type="button" class="btn" data-act="more">${esc(t('runD.showMore', { n: fmtNum(total - list.length) }))}</button></div>` : ''}
        </section>
      </div>
    </div>
    ${drawer}
  </div>`
}

/* ── states ───────────────────────────────────────────────────────────────── */
function statePanel(kind, title, hint, actions = '') {
  const icon = { error: 'cloud-off', unsupported: 'cloud-off', empty: 'inbox', nosession: 'list-tree', loading: 'clock' }[kind] || 'info'
  const cls = kind === 'error' ? 'is-error' : kind === 'unsupported' ? 'is-info' : ''
  return `<div class="state ${cls}">
    <span class="state-icon">${svg(icon, 'ic ic-lg')}</span>
    <h3>${esc(title)}</h3>
    <p>${esc(hint)}</p>
    ${actions}
  </div>`
}
function renderInlineEmpty() {
  return `<div style="padding:26px 18px" class="state" role="status">
    <span class="state-icon">${svg('inbox', 'ic ic-lg')}</span>
    <h3>${esc(t('trajectory.decisions.noMatches'))}</h3>
    <p>${esc(L(['当前筛选条件下没有记录。清除筛选可看到全部 59 条。', 'Nothing matches the current filters. Clear them to see all 59 records.']))}</p>
    <div class="actions"><button type="button" class="btn" data-act="clear">${esc(t('runD.clear'))}</button></div>
  </div>`
}
function renderSkeleton() {
  const row = (w) => `<div style="display:flex;gap:9px;align-items:center;padding:9px 14px;border-bottom:1px solid var(--hairline)">
    <span class="sk" style="width:20px;height:20px;border-radius:5px"></span>
    <span style="flex:1"><span class="sk" style="display:block;height:9px;width:${w}%"></span>
    <span class="sk" style="display:block;height:7px;width:${w - 22}%;margin-top:6px"></span></span>
    <span class="sk" style="width:44px;height:16px;border-radius:99px"></span></div>`
  return `<div>
    <div style="padding:14px 14px 0">
      <span class="sk" style="display:block;height:14px;width:38%"></span>
      <span class="sk" style="display:block;height:9px;width:62%;margin-top:8px"></span>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:9px;margin-top:14px">
        ${[0, 1, 2, 3].map(() => `<span class="sk" style="height:52px;border-radius:6px"></span>`).join('')}
      </div>
    </div>
    <div style="margin-top:14px">${[86, 71, 78, 64, 80, 69].map(row).join('')}</div>
  </div>`
}

/* ── top-level paint ──────────────────────────────────────────────────────── */
const REPORT = { coverage: 'partial', enabled: true, revision: 128 }

function paint() {
  const host = document.getElementById('host')
  const frame = document.getElementById('frame')
  const panel = document.getElementById('panel')
  document.documentElement.dataset.theme = S.theme
  document.documentElement.dataset.dir = S.dir
  document.documentElement.dataset.state = S.state
  frame.style.setProperty('--panel-w', S.width + 'px')
  document.querySelectorAll('[data-act="dir"] button').forEach(b => b.classList.toggle('is-on', b.dataset.dir === S.dir))
  document.querySelectorAll('[data-act="width"] button').forEach(b => b.classList.toggle('is-on', +b.dataset.width === S.width))
  document.querySelectorAll('[data-act="theme"] button').forEach(b => b.classList.toggle('is-on', b.dataset.theme === S.theme))
  document.querySelectorAll('[data-act="lang"] button').forEach(b => b.classList.toggle('is-on', b.dataset.lang === S.lang))
  document.querySelectorAll('[data-act="legacy"] button').forEach(b => b.classList.toggle('is-on', (b.dataset.legacy === '1') === !!S.legacyStatus))
  document.querySelectorAll('[data-icon]').forEach(el => { el.outerHTML = svg(el.dataset.icon, 'ic ic-sm') })
  document.querySelector('.chrome-select').value = S.state

  const wide = S.width >= 760
  document.getElementById('stageMeta').textContent =
    `${L(['方向', 'Direction'])} ${S.dir} · ${S.width}px · ${S.theme === 'light' ? L(['浅色', 'Light']) : L(['深色', 'Dark'])} · ${S.lang === 'zh-Hans' ? '中文' : 'English'}`
  document.getElementById('stageWide').textContent = S.dir === 'C'
    ? (wide ? L(['宽面板 · 矩阵展开 + 表格 + 右侧抽屉', 'Wide · matrix + table + right drawer'])
      : L(['窄面板 · 矩阵收起 + 卡片列表 + 底部抽屉', 'Narrow · collapsed matrix + cards + bottom sheet']))
    : wide
      ? (S.dir === 'B' ? L(['宽面板 · 单列（会显得空）', 'Wide · single column (reads empty)'])
        : L(['宽面板 · 主从双栏', 'Wide · master–detail']))
      : L(['窄面板 · 单列', 'Narrow · single column'])

  // 数据状态：整页级别
  if (S.state === 'nosession') {
    host.innerHTML = statePanel('nosession', t('runD.noSession'), t('runD.noSessionHint'))
    renderNotes(); return
  }
  if (S.state === 'loading') {
    host.innerHTML = `<div class="run-shell">${renderSkeleton()}</div>`; renderNotes(); return
  }
  if (S.state === 'error') {
    host.innerHTML = statePanel('error', t('trajectory.decisions.loadFailed'),
      L(['读取失败不会影响已经发生的记录；重试是只读操作。旧数据可能仍然显示，但会标注为非最新。',
        'A failed read does not affect records that already happened. Retry is read-only. Stale data may still show, marked as not current.']),
      `<div class="actions"><button type="button" class="btn" data-act="retry">${svg('info', 'ic ic-sm')}${esc(t('runD.retry'))}</button>
       <button type="button" class="btn btn-ghost" data-act="config">${esc(t('trajectory.decisions.configure'))}</button></div>`)
    renderNotes(); return
  }
  if (S.state === 'unsupported') {
    host.innerHTML = statePanel('unsupported', L(['此服务器不支持会话决策记录', 'This server does not support session decision records']),
      t('trajectory.decisions.unsupported'),
      `<div class="actions"><button type="button" class="btn btn-ghost" data-act="config">${esc(t('trajectory.decisions.configure'))}</button></div>`)
    renderNotes(); return
  }
  if (S.state === 'empty') {
    host.innerHTML = statePanel('empty', t('runD.notTriggered'), t('trajectory.decisions.emptyHint'),
      `<div class="actions"><button type="button" class="btn btn-accent" data-act="config">${svg('settings', 'ic ic-sm')}${esc(t('trajectory.decisions.configure'))}</button></div>`)
    renderNotes(); return
  }
  if (S.state === 'nomatch' && !S._nomatchApplied) {
    S.feature = 'decideTool'; S.status = 'failed'; S.q = 'zzz'; S._nomatchApplied = true
  } else if (S.state !== 'nomatch') { S._nomatchApplied = false }

  host.innerHTML = S.dir === 'A' ? renderA() : S.dir === 'B' ? renderB() : renderC()
  renderNotes()
}

/* ── notes (per direction) ────────────────────────────────────────────────── */
const NOTES = {
  A: {
    tag: 'Ledger',
    title: 'A · 台账 —— 列表即索引，详情在旁',
    lede: '把「记录」和「一条记录的全部事实」拆成两个互相独立的滚动区。列表永远保持自己的位置，详情永远在同一个地方出现。宽面板左右并置，窄面板整屏切换并保留返回位置。',
    ia: [
      '头部：会话范围 + 覆盖状态 + 配置入口（一行）',
      '指标条：4 格等宽数字，未知费用是 pill 不是文字',
      '功能分布：图标 + 占比条 + 三列等宽数字，点击即筛选',
      '筛选：状态 chip（带计数）+ 轮次 + 搜索，全部有可见的激活态',
      '列表：状态色条 + 功能图标 + 动作标题 + 次要行 + 开销',
      '详情：触发场景 → 模型判断 → 实际处理 → 后续观察 → 请求明细',
    ],
    narrow: '选择一条记录后列表整体让位给详情，顶部出现「返回列表」；返回时列表的滚动位置与选中态都保留。',
    wide: '≥720px 时变成真正的主从：左列 280–384px，右列详情独立滚动，键盘 ↑↓ 直接切换右列内容。',
    why: [
      '59 条记录里真正需要读的只有几条，列表必须能「扫」，详情必须能「停」。',
      '选择模型（selection）比展开模型（accordion）更适合对照：看完第 3 条再看第 5 条时，不需要重新定位。',
      '与设计文档 §4.2 第 4 条完全一致：宽面板侧边展开，窄面板同面板详情。',
    ],
    tradeoff: [
      '新增选择态与两套布局，键盘与焦点管理要一起做（↑↓ / Home / End / Esc）。',
      '窄面板下「返回」是必要成本；没有它用户会迷路。',
    ],
    cost: '约 420–520 行 TSX + 90 行共享组件抽取；`SessionDecisions.tsx` 需要拆成 `DecisionLedger` / `DecisionList` / `DecisionDetail` 三个文件。',
  },
  B: {
    tag: 'Stream',
    title: 'B · 时间流 —— 就地展开，按轮次分组',
    lede: '保留今天的单列结构，但把它做成一条真正的时间流：左侧一条竖向轨道、状态节点按结果着色、按轮次分组并吸附分组头、点击就地展开完整详情。',
    ia: [
      '头部：标题 + 覆盖状态 + 一整行「59 事项 · 4 改变 · 4 回退 · $0.06+?」摘要',
      '滚动后头部压缩成一行，把纵向空间让给内容',
      '功能分布横向铺开成一块可点的区域，单列下不占纵向空间',
      '轮次分组头吸附在顶部，明确「现在是哪一轮」',
      '每条记录左侧是轨道节点，颜色即结果；点击就地展开',
    ],
    narrow: '天然适配，是一切的基准；420px 下分组头 + 轨道 + 单行摘要都在。',
    wide: '问题所在：单列在 1040px 下每行过长、留白过多，需要限制正文宽度，或者直接切到 A/C。',
    why: [
      '改动最小、回归风险最低，交互模型与现在完全一致，用户不需要重新学。',
      '轮次分组解决「59 条不知道从哪看起」的问题，也是最贴近用户心智的分段方式。',
    ],
    tradeoff: [
      '跨功能对比弱：功能分布被时间顺序打散，想知道「哪个功能最费钱」要来回看。',
      '记录多时流很长，虽然有分组头，仍然依赖滚动。',
    ],
    cost: '约 260–320 行 TSX，几乎不新增组件；主要工作是分组、轨道与展开动效。',
  },
  C: {
    tag: 'Board',
    title: 'C · 决策板 —— 先对比，再下钻',
    lede: '与 Run 其余标签页同一种读法：状态行 → 四块指标瓷砖 → 功能对比 → 决策记录。功能对比是一张可以横向比较的矩阵，记录是一张 30px 行高的密集表格，点任意一行从右侧（窄屏从底部）拉出详情抽屉，列表始终留在原位。',
    ia: [
      '状态行：状态点 + 13px 标题 + 覆盖状态标签 + 右侧元信息 + 配置入口',
      '指标瓷砖：决策事项 / 实际改变 / 回退 / 决策费用 —— 四块同权重，费用排在最后',
      '账户口径：11px 说明行（请求数、待确认、失败、取消、Token、已含于会话费用）',
      '分区「功能对比」：功能 · 事项 · 改变 · 回退 · 失败 · 占比 · 开销，带合计行；窄面板自动收起',
      '分区「决策记录」：Run 工具栏（筛选 / 轮次 / 计数 / 搜索）+ 30px 行高的表格',
      '详情以抽屉覆盖，列表保持可见',
    ],
    narrow: '矩阵自动收起为「展开」；记录表降级成卡片列表（复用同一套记录行组件）；抽屉从底部升起并贴住面板底边。',
    wide: '三个方向里信息密度最高的：760px 以上矩阵展开、表格列全部可见，一屏能扫完 59 条的关键字段。',
    why: [
      '面向「审计」而不是「阅读」：用户想知道的是分布、异常与成本，而不是逐条故事。',
      '功能对比矩阵直接回应设计文档 §5.3：不提供统一评分，但把计数与费用分开、可信与未知分开。',
      '不再内嵌第二层标签条 —— Run 已经有一层标签，套两层会让人不知道自己在哪；改用与概览一致的分区。',
    ],
    tradeoff: [
      '矩阵占纵向空间；窄面板靠「默认收起」解决，代价是多一次点击。',
      '窄面板的表格降级是额外的一整套分支，验收面积比 A/B 大。',
      '⚠ 实施时宽/窄分支必须由容器查询（或 useContainerWidth）决定，不能由外层传入的宽度状态决定 —— 面板被拉伸或压缩时两者会不一致，表格就会溢出。',
    ],
    cost: '约 420–500 行 TSX；主要是矩阵、表格与抽屉三块，窄面板降级复用记录行组件。',
  },
}

function renderNotes() {
  const n = NOTES[S.dir]
  const el = document.getElementById('notes')
  el.innerHTML = `
  <div class="note-card">
    <h2><span class="tag">${n.tag}</span>${esc(n.title)}</h2>
    <p class="lede">${esc(n.lede)}</p>
    <dl class="stack" style="gap:11px">
      <div class="note-row"><dt>信息架构</dt><dd><ul>${n.ia.map(x => `<li>${esc(x)}</li>`).join('')}</ul></dd></div>
      <div class="note-row"><dt>窄面板</dt><dd>${esc(n.narrow)}</dd></div>
      <div class="note-row"><dt>宽面板</dt><dd>${esc(n.wide)}</dd></div>
      <div class="note-row"><dt>为什么</dt><dd><ul>${n.why.map(x => `<li>${esc(x)}</li>`).join('')}</ul></dd></div>
      <div class="note-row"><dt>取舍</dt><dd><ul>${n.tradeoff.map(x => `<li>${esc(x)}</li>`).join('')}</ul></dd></div>
      <div class="note-row"><dt>实施落点</dt><dd><code>${esc(n.cost)}</code></dd></div>
    </dl>
    <div class="note" style="border-radius:6px;background:var(--muted)">
      ${svg('info', 'ic ic-sm')}
      <span>${esc(L([
        `当前演示的宽度是 ${S.width}px，${S.width >= 720 ? '已进入宽面板分支。' : '属于窄面板分支 —— 这是 Run 面板最常见的情形。'}`,
        `Current width is ${S.width}px, ${S.width >= 720 ? 'so the wide branch is active.' : 'so the narrow branch is active — the most common case for the Run panel.'}`,
      ]))}</span>
    </div>
  </div>`
}

/* ── shared-system cards (静态展示，复用真实组件) ─────────────────────────── */
function renderSystem() {
  const cards = []

  cards.push(`
  <div class="sys-card">
    <h3>${svg('info', 'ic ic-sm')}状态词汇表（9 种）</h3>
    <p>结果不再是一行灰字。色调沿用 Run 表格的 kind 标签：品牌紫 / 琥珀 / 红 / 中性灰，另用实心与空心点做第二重编码；文字永远在。
      <b>不用绿色表示「已应用」</b> —— 风险标记是信息辅助，绿色会被读成「已批准」。</p>
    <div class="sys-demo">
      ${['changed', 'applied', 'unchanged', 'fallback', 'discarded', 'failed', 'cancelled', 'pending', 'historical']
        .map(s => statusTag(s)).join('')}
    </div>
    <p class="bad">其中 <b>失败</b> 与 <b>已取消</b> 在当前实现里不可达：<code>status()</code> 只从
      <code>application.status</code> 取 <code>failed</code>/<code>cancelled</code>，而该字段的联合类型是
      <code>applied | unchanged | fallback | discarded | unknown</code> —— 没有这两个值。请求层的
      <code>failed</code>/<code>timeout</code>/<code>cancelled</code> 从未被读过。</p>
    <div class="sys-demo" style="gap:10px">
      <span class="note-line">按当前实现：</span>
      ${statusTag('failed')}<span class="note-line">→ 实际渲染成</span>${statusTag('unconfirmed')}
    </div>
  </div>`)

  cards.push(`
  <div class="sys-card">
    <h3>${svg('clock', 'ic ic-sm')}费用：未知是状态，不是后缀</h3>
    <p>现在的 <code>$0.06 + Unknown × 4</code> 把两种数量级的信息拼进一个字符串，既不能对齐也不能排序。
      改成等宽数字 + 独立的 warn 标签，并给出 <code>title</code> 说明。</p>
    <div class="sys-demo">
      <span class="tnum" style="font-size:16px;font-weight:600;font-variant-numeric:tabular-nums">$0.06</span>
      <span class="tag tone-warn">${esc(t('runD.unknownPill', { n: 4 }))}</span>
      <span class="note-line">vs 现在：$0.06 + Unknown × 4</span>
    </div>
  </div>`)

  cards.push(`
  <div class="sys-card">
    <h3>${svg('list-tree', 'ic ic-sm')}功能分布：数字对齐 + 形状</h3>
    <p>事项 / 改变 / 开销三列用等宽数字右对齐，占比用 3px 细条表达；「一项也算」的功能不会被埋掉。点击整行即筛选。</p>
    <div class="sys-demo" style="display:block">
      <div class="demo-surface">${featureDistribution()}</div>
    </div>
  </div>`)

  cards.push(`
  <div class="sys-card">
    <h3>${svg('corner-down-right', 'ic ic-sm')}证据：字段，不是 JSON</h3>
    <p>「触发来源」现在是 <code>&lt;pre&gt;{JSON.stringify(…)}</code>。改成与 Run → 概览「环境」完全同款的键值网格
      （标签左、值右，≥620px 双列），原始记录退到折叠里 —— 需要精确值时仍然拿得到。</p>
    <div class="sys-demo" style="display:block">
      <div class="demo-surface">
        <dl class="kv" style="border-top:0;padding-top:0">
          <div class="kv-row"><dt>轮次</dt><dd>第 18 轮</dd></div>
          <div class="kv-row"><dt>消息</dt><dd class="mono">msg-8f21</dd></div>
          <div class="kv-row"><dt>工具调用</dt><dd class="mono">call-3a91</dd></div>
        </dl>
        <details class="ev"><summary>原始记录</summary>
          <div class="ev-body"><pre>{ "messageId": "msg-8f21", "turnId": "t18" }</pre></div>
        </details>
      </div>
    </div>
  </div>`)

  cards.push(`
  <div class="sys-card">
    <h3>${svg('ban', 'ic ic-sm')}空态 / 错误态：各自可行动</h3>
    <p>设计文档 §9 列了 16 种页面状态，现在只有「加载中 / 失败 / 无记录 / 筛选无结果」四种，且都是一行灰字。
      每种状态给出下一步，而不是只报「没有数据」。</p>
    <div class="sys-demo" style="display:grid;grid-template-columns:1fr 1fr;gap:7px">
      ${[['未触发', 'inbox'], ['加载中', 'clock'], ['读取失败', 'cloud-off'], ['不支持', 'cloud-off']]
        .map(([label, icon]) => `<span class="tag tone-neutral" style="height:26px;font-size:11px;padding:0 8px">${svg(icon, 'ic ic-sm')}${esc(label)}</span>`).join('')}
    </div>
  </div>`)

  cards.push(`
  <div class="sys-card">
    <h3>${svg('type', 'ic ic-sm')}顺手修掉的文案缺陷</h3>
    <p><code>trajectory.decisions.status.applied</code> 这个键<b>不存在</b>。而 <code>status()</code> 在
      「已应用但未改变基线」时会返回 <code>'applied'</code> —— 这是最常见的形态（例如风险标记附加成功但没改动任何东西），
      结果是界面上直接漏出 <code>trajectory.decisions.status.applied</code> 这串键名。</p>
    <p>另外三个计数串没有复数形式，英文下会出现 <b>“1 model attempts”“1 points · 0 changes”</b> ——
      现有验收截图 <code>light-en-1040-detail.png</code> 里就是 <code>1 points · 0 changes</code>。
      i18n 覆盖率门禁跳过动态键，所以三个门禁都抓不到。</p>
    <div class="sys-demo" style="display:block">
      <div class="note">
        ${svg('info', 'ic ic-sm')}
        <span>修法：新增 <code>status.applied</code>；把 <code>attemptCount</code> / <code>featureCounts</code> / <code>legacyCalls</code>
        改成 <code>_one</code> / <code>_other</code> 成对键，用 i18next 的 <code>count</code> 复数机制，不要手写三元判断。</span>
      </div>
    </div>
  </div>`)

  document.getElementById('sysGrid').innerHTML = cards.join('')
}

/* ── interaction ──────────────────────────────────────────────────────────── */
function bind() {
  document.addEventListener('click', (e) => {
    const dirBtn = e.target.closest('[data-act="dir"] button')
    if (dirBtn) { S.dir = dirBtn.dataset.dir; S.drawer = false; paint(); return }
    const wBtn = e.target.closest('[data-act="width"] button')
    if (wBtn) { S.width = +wBtn.dataset.width; S.matrixOpen = undefined; paint(); return }
    const thBtn = e.target.closest('[data-act="theme"] button')
    if (thBtn) { S.theme = thBtn.dataset.theme; paint(); return }
    const lgBtn = e.target.closest('[data-act="lang"] button')
    if (lgBtn) { S.lang = lgBtn.dataset.lang; document.documentElement.lang = S.lang; paint(); return }
    const lcBtn = e.target.closest('[data-act="legacy"] button')
    if (lcBtn) { S.legacyStatus = lcBtn.dataset.legacy === '1'; paint(); return }

    const el = e.target.closest('[data-act]')
    if (!el || !document.getElementById('panel').contains(el)) return
    const act = el.dataset.act
    if (act === 'select') {
      S.selected = el.dataset.id
      if (S.width < 720 && S.dir === 'A') { /* 窄屏：详情整屏，paint 会加 is-detail */ }
      if (S.dir === 'C') S.drawer = true
      paint()
    } else if (act === 'toggle') {
      if (S.open.has(el.dataset.id)) S.open.delete(el.dataset.id); else S.open.add(el.dataset.id)
      paint()
    } else if (act === 'feature') {
      S.feature = S.feature === el.dataset.feature ? '' : el.dataset.feature; S.shown = 14; paint()
    } else if (act === 'featureMore') {
      S.featureOpen = !S.featureOpen; paint()
    } else if (act === 'status') {
      S.status = S.status === el.dataset.status ? '' : el.dataset.status; S.shown = 14; paint()
    } else if (act === 'clear') {
      S.feature = ''; S.status = ''; S.turn = ''; S.q = ''; paint()
    } else if (act === 'clearAll') {
      S.feature = ''; S.status = ''; S.turn = ''; S.q = ''; S.shown = 14; paint()
    } else if (act === 'more') {
      S.shown += 14; paint()
    } else if (act === 'matrixToggle') {
      const open = S.matrixOpen === undefined ? S.width >= 760 : S.matrixOpen
      S.matrixOpen = !open; paint()
    } else if (act === 'sort') {
      if (S.sort === el.dataset.sort) S.sortDir = S.sortDir === 'desc' ? 'asc' : 'desc'
      S.sort = el.dataset.sort; paint()
    } else if (act === 'close') {
      S.drawer = false; paint()
    } else if (act === 'back') {
      S.selected = null; S.drawer = false; paint()
    } else if (act === 'retry') {
      paint()
    } else if (act === 'chat' || act === 'locate') {
      el.animate([{ transform: 'scale(1)' }, { transform: 'scale(.96)' }, { transform: 'scale(1)' }], { duration: 180 })
    } else if (act === 'config') {
      el.animate([{ opacity: 1 }, { opacity: .5 }, { opacity: 1 }], { duration: 240 })
    }
  })

  document.addEventListener('input', (e) => {
    const el = e.target.closest('[data-act="q"]')
    if (!el) return
    S.q = el.value; S.shown = 14
    const pos = el.selectionStart
    paint()
    const next = document.querySelector('[data-act="q"]')
    if (next) { next.focus(); try { next.setSelectionRange(pos, pos) } catch { /* search inputs */ } }
  })

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-act="turn"]')
    if (el) { S.turn = el.value; S.shown = 14; paint(); return }
    const st = e.target.closest('[data-act="state"]')
    if (st) {
      S.state = st.value
      if (S.state !== 'nomatch') { S.feature = ''; S.status = ''; S.q = '' }
      S.drawer = false
      paint()
    }
  })

  document.addEventListener('keydown', (e) => {
    const panel = document.getElementById('panel')
    if (!panel.contains(document.activeElement) && !panel.contains(e.target)) {
      if (e.key === 'Escape' && S.drawer) { S.drawer = false; paint() }
      return
    }
    if (e.key === 'Escape') {
      if (S.drawer) { S.drawer = false; paint() }
      else if (S.dir === 'A' && S.selected) { S.selected = null; paint() }
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const rows = [...panel.querySelectorAll('[data-act="select"]')]
    if (!rows.length) return
    e.preventDefault()
    const idx = rows.findIndex(r => r.dataset.id === S.selected)
    const next = rows[Math.min(rows.length - 1, Math.max(0, (idx < 0 ? 0 : idx) + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (next) {
      S.selected = next.dataset.id
      if (S.dir === 'C') S.drawer = true
      paint()
      requestAnimationFrame(() => document.querySelector(`[data-act="select"][data-id="${S.selected}"]`)?.focus())
    }
  })

  // B 方向：滚动时压缩头部
  document.getElementById('host').addEventListener('scroll', (e) => {
    const scroller = e.target.closest('.b-scroll')
    if (!scroller) return
    const head = document.getElementById('bHead')
    if (head) head.classList.toggle('is-compact', scroller.scrollTop > 36)
  }, true)
}

/* ── boot ─────────────────────────────────────────────────────────────────── */
/** ?dir=A|B|C & width=420 & theme=light|dark & lang=zh-Hans|en & state=… & view=full|panel
    可分享的深链接；也是截图矩阵的入口。 */
function readParams() {
  const p = new URLSearchParams(location.search)
  if (['A', 'B', 'C'].includes(p.get('dir'))) S.dir = p.get('dir')
  if (['light', 'dark'].includes(p.get('theme'))) S.theme = p.get('theme')
  if (['zh-Hans', 'en'].includes(p.get('lang'))) S.lang = p.get('lang')
  const w = Number(p.get('width'))
  if (w >= 300 && w <= 1400) S.width = w
  if (p.get('state')) S.state = p.get('state')
  if (p.get('view') === 'panel') document.body.classList.add('view-panel')
  if (p.get('feature')) S.feature = p.get('feature')
  if (p.get('status')) S.status = p.get('status')
  if (p.get('legacyStatus') === '1') S.legacyStatus = true
  if (p.get('selected') === 'none') S.selected = null
  else if (p.get('selected')) S.selected = p.get('selected')
  if (p.get('featureOpen') === '1') S.featureOpen = true
  if (p.get('matrix') === 'open') S.matrixOpen = true
  if (p.get('matrix') === 'closed') S.matrixOpen = false
  if (p.get('drawer') === '1') { S.drawer = true; if (!S.selected) S.selected = ALL_ITEMS[0].id }
  document.documentElement.lang = S.lang
}

readParams()
bind()
renderSystem()
paint()
