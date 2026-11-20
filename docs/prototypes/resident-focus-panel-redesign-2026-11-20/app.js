/* ─────────────────────────────────────────────────────────────────────
   助手 Focus 面板优化 · 评审稿
   ---------------------------------------------------------------------
   布局不换，改五处：
     1. 档位条 = 切换器：一根条 = 一个任务，点条即聚焦（不再有标题切换条）
     2. 条数 = 在跑任务数（不再固定 18 根）
     3. 条本身用形状 + 颜色读得出状态
     4. 记录卡片内最大 14px（现状 16px 标题 + 一片 10px）
     5. 两个承载面：标题栏 peek 两栏 / 助手侧边栏纵向单栏

   全部内容为设计 fixture：形状对齐 session-tools-core 的真实契约
   （TaskProjectionView / TaskPageView / TaskDeliverable），阶段词与
   i18n 键沿用产品现有文案。
   ───────────────────────────────────────────────────────────────────── */
'use strict'

const $ = selector => document.querySelector(selector)

const state = {
  surface: 'peek',
  version: 'optimized',
  scenario: 'ready',
  theme: 'light',
  lang: 'zh',
  selected: undefined,
  busy: undefined,
  notice: undefined,
  railOpen: false,
}

/* ── 文案 ───────────────────────────────────────────────────────────── */
const COPY = {
  zh: {
    panel: '本次任务',
    taskCount: '{{count}} 个任务',
    refresh: '刷新',
    close: '关闭',
    empty: '还没有登记委托。直接在对话里说明目标即可。',
    loading: '正在读取…',
    errorRead: '无法读取任务投影。后台服务可能刚重启。',
    offline: '连接已断开 · 正在显示上次取得的状态',
    retry: '重新读取',
    goal: '目标',
    scope: '范围',
    deliverable: '交付形式',
    definition: '定义',
    requirements: '要求',
    acceptance: '验收条件',
    assignments: '派工',
    noReq: '还没有记录要求。',
    noAssign: '还没有派工。',
    accept: '验收通过',
    rework: '要求返工',
    pause: '暂停',
    resume: '恢复',
    terminate: '终止',
    openTask: '打开原任务',
    deliverables: '产物',
    inFlight: '执行中',
    inQueue: '排队',
    paused: '已暂停',
    capacity: '运行 {{occupied}} / {{capacity}}',
    askedLabel: '为什么需要你决定',
    legend: '图例',
    showRail: '展开产物',
    hideRail: '收起产物',
    stages: {
      intake: '未就绪', ready: '已就绪', queued: '已入队', running: '正在执行',
      stopping: '正在停止', paused: '已暂停', candidate_result: '待验收',
      needs_user: '需要你决定', accepted: '已验收', rework: '已要求返工',
      failed: '失败', cancelled: '已终止',
    },
    reqState: { active: '生效中', superseded: '已被取代', withdrawn: '已撤回' },
    assignState: {
      admitted: '已受理', queued: '已入队', running: '执行中', stopping: '正在停止',
      stopped: '已停止', completed: '已完成', failed: '失败', cancelled: '已取消',
    },
    outcome: { met: '满足', gap: '缺口', undecided: '待判断', pending: '未判断' },
    version: '第 {{version}} 版',
    executed: '执行 v{{version}}',
    ago: seconds => (seconds < 60 ? '刚刚' : seconds < 3600 ? `${Math.round(seconds / 60)} 分钟前` : `${Math.round(seconds / 3600)} 小时前`),
    capacityAria: '执行容量 {{occupied}} / {{capacity}}',
    barAria: '{{title}} · {{stage}}',
    notePeek: '<strong>标题栏 peek</strong>：鼠标移上 / 点击标题栏的助手入口时出现。两栏 —— 左记录、右产物，与现状一致，只换了档位条与字号。',
    noteDock: '<strong>助手侧边栏</strong>：进入助手界面后点「更多」出现。一块<strong>靠右的悬浮面板</strong>（四周留边、圆角与阴影同 peek 一档），<strong>自上而下纵向排布</strong>：头部 → 档位条 → 记录 → 产物 → 动作。窗口窄而高，横着分栏只会把每个字挤成两半。',
    noteCurrent: '<strong>现状</strong>：容量条是 18 个固定方块（303px），把任务标题条挤到只剩 0–188px；标题 16px，其余全部 10px；长标识会让记录区横向滚动。',
    noteOptimized: '<strong>优化后</strong>：档位条一根一个任务（点即切换）、条数跟着任务走、条用形状读状态；记录卡片内最大 14px，要求原文 13px。',
  },
  en: {
    panel: 'This task',
    taskCount: '{{count}} tasks',
    refresh: 'Refresh',
    close: 'Close',
    empty: 'No delegation recorded yet. Describe what you want in the conversation.',
    loading: 'Reading…',
    errorRead: 'Could not read the task projection. The background service may have just restarted.',
    offline: 'Disconnected · showing the last available snapshot',
    retry: 'Read again',
    goal: 'Goal',
    scope: 'Scope',
    deliverable: 'Deliverable',
    definition: 'Definition',
    requirements: 'Requirements',
    acceptance: 'Acceptance',
    assignments: 'Assignments',
    noReq: 'No requirement recorded yet.',
    noAssign: 'No assignment yet.',
    accept: 'Accept',
    rework: 'Request rework',
    pause: 'Pause',
    resume: 'Resume',
    terminate: 'Terminate',
    openTask: 'Open task',
    deliverables: 'Deliverables',
    inFlight: 'In flight',
    inQueue: 'Queued',
    paused: 'Paused',
    capacity: 'Running {{occupied}} / {{capacity}}',
    askedLabel: 'Why this needs you now',
    legend: 'Legend',
    showRail: 'Show deliverables',
    hideRail: 'Hide deliverables',
    stages: {
      intake: 'Not ready', ready: 'Ready', queued: 'Queued', running: 'Running',
      stopping: 'Stopping', paused: 'Paused', candidate_result: 'Awaiting acceptance',
      needs_user: 'Needs your decision', accepted: 'Accepted', rework: 'Rework requested',
      failed: 'Failed', cancelled: 'Terminated',
    },
    reqState: { active: 'In force', superseded: 'Superseded', withdrawn: 'Withdrawn' },
    assignState: {
      admitted: 'Admitted', queued: 'Queued', running: 'Running', stopping: 'Stopping',
      stopped: 'Stopped', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled',
    },
    outcome: { met: 'Met', gap: 'Gap', undecided: 'Undecided', pending: 'Not judged' },
    version: 'v{{version}}',
    executed: 'executing v{{version}}',
    ago: seconds => (seconds < 60 ? 'just now' : seconds < 3600 ? `${Math.round(seconds / 60)} min ago` : `${Math.round(seconds / 3600)} h ago`),
    capacityAria: 'Execution capacity {{occupied}} / {{capacity}}',
    barAria: '{{title}} · {{stage}}',
    notePeek: '<strong>Titlebar peek</strong>: appears when the pointer rests on the assistant entry. Two columns — record on the left, deliverables on the right — as today; only the gauge row and the type scale changed.',
    noteDock: '<strong>Assistant side panel</strong>: opens from “More” inside the assistant view. A <strong>floating panel anchored to the right</strong> (inset on every side, same corner language and shadow as the peek), <strong>laid out top to bottom</strong>: header → gauge row → record → deliverables → actions. The window is tall and narrow; splitting it into columns squeezes every line.',
    noteCurrent: '<strong>Today</strong>: the capacity strip is eighteen fixed blocks (303px) that squeeze the task switcher down to 0–188px; the title is 16px and everything else is 10px; a long identifier makes the record scroll sideways.',
    noteOptimized: '<strong>Optimized</strong>: one bar per task (click to focus), the bar count follows the task count, and a bar\u2019s shape tells you its state; record content is 14px at most, requirement prose 13px.',
  },
}

function t(key, vars) {
  const text = key.split('.').reduce((node, part) => (node == null ? node : node[part]), COPY[state.lang])
  const template = typeof text === 'string' ? text : key
  return vars ? template.replace(/\{\{(\w+)\}\}/g, (_, name) => (vars[name] ?? '')) : template
}

const copy = () => COPY[state.lang]
const agoLabel = seconds => copy().ago(seconds)
const escapeHtml = value => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/* ── 契约派生：与 focus-board.ts 一致，不在渲染里重算 ───────────────── */
const TONE = {
  intake: 'idle', ready: 'idle', queued: 'idle', running: 'active', stopping: 'active',
  paused: 'idle', candidate_result: 'needs', needs_user: 'needs', rework: 'needs',
  accepted: 'settled', failed: 'failed', cancelled: 'settled',
}
const GROUP = {
  intake: 'active', ready: 'active', queued: 'active', running: 'active', stopping: 'active',
  paused: 'active', candidate_result: 'needs', needs_user: 'needs', rework: 'needs',
  accepted: 'settled', failed: 'settled', cancelled: 'settled',
}
/** 档位条里出现哪些任务：面板的职责是「现在要处理什么」，已定案的不占条。 */
const GAUGED = task => task.stage !== 'accepted' && task.stage !== 'cancelled'

const stageLabel = stage => t(`stages.${stage}`)
const stageMark = stage => `<span class="stage" data-tone="${TONE[stage]}">${escapeHtml(stageLabel(stage))}</span>`

/** Host 的派生规则，与 focus-board.ts 的 actionsFor 一致。 */
function actionsFor(task) {
  if (task.control === 'terminate') return []
  if (task.verdict === 'accepted') return []
  if (task.control === 'pause') return ['resume']
  if (task.stage === 'candidate_result' || task.stage === 'rework') return ['accept', 'rework']
  if (task.stage === 'accepted') return []
  return ['pause', 'terminate']
}

/** 打开的默认目标：先看需要你的，再看在跑的。与 initialFocus 同一规则。 */
function initialFocus(tasks) {
  return tasks.find(task => GROUP[task.stage] === 'needs')?.id
    ?? tasks.find(task => GROUP[task.stage] === 'active')?.id
    ?? tasks[0]?.id
}

/* ── fixture ────────────────────────────────────────────────────────── */
const LONG_IDENTIFIER = 'src/renderer/components/resident-assistant/delivery-reconciliation.ts'
const EXTREME =
  'internal://reports/2026/Q4/%E5%91%A8%E6%8A%A5-reconciliation--flagship-dashboard-v3--atlas-lumen-口径对照与差异复核'

function baseTasks({ english = false } = {}) {
  if (english) {
    return [
      {
        id: 'tsk_7f21', title: 'Lumen activity window: keep 7 days or unify on 30', stage: 'needs_user',
        goal: 'Unify three activity windows into one externally defensible standard',
        scopeIn: ['Lumen metric notes', 'Q4 weekly draft'], scopeOut: ['Infrastructure usage', 'Billing window'],
        deliverable: 'One-page window comparison plus the revised weekly',
        defVersion: 3, executedVersion: 2, ago: 4,
        requirements: [
          { id: 'r1', version: 3, state: 'active', statement: 'The activity window defaults to a 30-day span. The 7-day span is annotated on the Lumen side only and never merged into the body copy.' },
          { id: 'r2', version: 2, state: 'superseded', statement: 'Count on the 7-day window first and attach 30 days on a separate page.' },
          { id: 'r3', version: 2, state: 'active', statement: 'The difference page keeps both computations and states when each applies.' },
        ],
        acceptance: [
          { id: 'c1', statement: 'The weekly body no longer carries two activity figures', outcome: 'pending' },
          { id: 'c2', statement: 'The difference page names a source for each computation', outcome: 'pending' },
        ],
        assignments: [
          { version: 2, sessionId: 'ses_a91c4', state: 'running' },
          { version: 1, sessionId: 'ses_44b0e', state: 'completed' },
        ],
        requiresUserFor: 'The same metric is reported with two different numbers across two documents; you decide which one goes out.',
      },
      {
        id: 'tsk_3b90', title: 'Q4 weekly review: keep both windows on the difference page', stage: 'candidate_result',
        goal: 'Produce a Q4 weekly that can go out as is',
        scopeIn: ['Q4 weekly draft'], scopeOut: ['Annual budget'], deliverable: 'Weekly v3 (external)',
        defVersion: 2, executedVersion: 2, ago: 11,
        requirements: [{ id: 'r4', version: 2, state: 'active', statement: 'The body keeps one activity window; the difference page keeps both and names their sources.' }],
        acceptance: [
          { id: 'c3', statement: 'Every figure points back to a source', outcome: 'met' },
          { id: 'c4', statement: 'Both computations on the difference page carry one line of attribution', outcome: 'gap' },
        ],
        assignments: [{ version: 2, sessionId: 'ses_44b0e', state: 'completed' }],
      },
      {
        id: 'tsk_5120', title: 'Unify the Atlas and Lumen metric windows', stage: 'running',
        goal: 'Both dashboards report one number for the same metric',
        scopeIn: ['Atlas dashboard', 'Lumen dashboard'], scopeOut: ['Historical archive'],
        deliverable: 'The unified window note', defVersion: 4, executedVersion: 4, ago: 2,
        requirements: [
          { id: 'r5', version: 4, state: 'active', statement: 'Unify on the 30-day window first; keep the difference page separate and out of the body.' },
          { id: 'r6', version: 2, state: 'withdrawn', statement: 'Recompute all of the Atlas history within two weeks.' },
        ],
        acceptance: [{ id: 'c5', statement: 'Both dashboards report one number for the same metric', outcome: 'pending' }],
        assignments: [{ version: 4, sessionId: 'ses_a91c4', state: 'running' }],
      },
      {
        id: 'tsk_2c48', title: 'Review the Q4 window comparison table', stage: 'queued',
        goal: 'Review the figures in the comparison table', scopeIn: ['Window comparison table'], scopeOut: [],
        deliverable: 'A review record', defVersion: 1, executedVersion: 1, ago: 18, blocked: true,
        requirements: [{ id: 'r7', version: 1, state: 'active', statement: 'Every figure in the comparison table must point back to a source.' }],
        acceptance: [{ id: 'c6', statement: 'No figure in the table lacks a source', outcome: 'pending' }],
        assignments: [],
      },
      {
        id: 'tsk_9de3', title: 'Check the source-citation retention policy', stage: 'ready',
        goal: 'Confirm source citations can be removed safely', scopeIn: ['Source citations'], scopeOut: ['Model config'],
        deliverable: 'A one-page conclusion', defVersion: 1, executedVersion: 1, ago: 25,
        requirements: [{ id: 'r8', version: 1, state: 'active', statement: 'Remove the citation only, never the source itself.' }],
        acceptance: [], assignments: [],
      },
    ]
  }
  return [
    {
      id: 'tsk_7f21', title: 'Lumen 活跃口径：保留 7 天还是统一 30 天', stage: 'needs_user',
      goal: '把三套活跃口径统一成一套可对外解释的标准',
      scopeIn: ['Lumen 指标说明', 'Q4 周报草稿'], scopeOut: ['基础设施用量', '计费口径'],
      deliverable: '一页口径对照说明 + 修订后的周报',
      defVersion: 3, executedVersion: 2, ago: 4,
      requirements: [
        { id: 'r1', version: 3, state: 'active', statement: '活跃口径默认按 30 天窗口计算；7 天窗口只在 Lumen 侧单独标注，不能并入正文。' },
        { id: 'r2', version: 2, state: 'superseded', statement: '先用 7 天窗口统计，30 天另附一页。' },
        { id: 'r3', version: 2, state: 'active', statement: '差异页保留两套计算方式，并写明各自适用场景。' },
      ],
      acceptance: [
        { id: 'c1', statement: '周报正文不再出现两套活跃数字', outcome: 'pending' },
        { id: 'c2', statement: '差异页对两套口径各有一句来源说明', outcome: 'pending' },
      ],
      assignments: [
        { version: 2, sessionId: 'ses_a91c4', state: 'running' },
        { version: 1, sessionId: 'ses_44b0e', state: 'completed' },
      ],
      requiresUserFor: '同一个指标在两份材料里给出了两个数字，需要你确定对外采用哪一个。',
    },
    {
      id: 'tsk_3b90', title: 'Q4 周报复核：差异页保留两套口径', stage: 'candidate_result',
      goal: '生成可以直接对外的 Q4 周报',
      scopeIn: ['Q4 周报草稿'], scopeOut: ['年度预算'], deliverable: '周报 v3（对外版）',
      defVersion: 2, executedVersion: 2, ago: 11,
      requirements: [{ id: 'r4', version: 2, state: 'active', statement: '正文只保留一套活跃口径，差异页保留两套并注明来源。' }],
      acceptance: [
        { id: 'c3', statement: '每个数字都能回指到一个来源', outcome: 'met' },
        { id: 'c4', statement: '差异页两套口径各有一行来源说明', outcome: 'gap' },
      ],
      assignments: [{ version: 2, sessionId: 'ses_44b0e', state: 'completed' }],
    },
    {
      id: 'tsk_5120', title: 'Atlas 与 Lumen 数据口径统一', stage: 'running',
      goal: '两个看板对同一指标给出同一个数', scopeIn: ['Atlas 看板', 'Lumen 看板'],
      scopeOut: ['历史归档'], deliverable: '统一后的口径说明', defVersion: 4, executedVersion: 4, ago: 2,
      requirements: [
        { id: 'r5', version: 4, state: 'active', statement: '先统一 30 天口径，差异页单独留着，不并入正文。' },
        { id: 'r6', version: 2, state: 'withdrawn', statement: '两周内把 Atlas 的历史数据全部重算。' },
      ],
      acceptance: [{ id: 'c5', statement: '两个看板对同一指标给出同一个数', outcome: 'pending' }],
      assignments: [{ version: 4, sessionId: 'ses_a91c4', state: 'running' }],
    },
    {
      id: 'tsk_2c48', title: 'Q4 口径对照表复核', stage: 'queued',
      goal: '复核口径对照表的数字', scopeIn: ['口径对照表'], scopeOut: [], deliverable: '复核记录',
      defVersion: 1, executedVersion: 1, ago: 18, blocked: true,
      requirements: [{ id: 'r7', version: 1, state: 'active', statement: '对照表里每个数字都要能回指来源。' }],
      acceptance: [{ id: 'c6', statement: '对照表没有无法回指的数字', outcome: 'pending' }],
      assignments: [],
    },
    {
      id: 'tsk_9de3', title: '来源引用保留策略检查', stage: 'ready',
      goal: '确认知识来源引用可以安全删除', scopeIn: ['来源引用'], scopeOut: ['模型配置'],
      deliverable: '一页结论', defVersion: 1, executedVersion: 1, ago: 25,
      requirements: [{ id: 'r8', version: 1, state: 'active', statement: '只删引用，不删来源本身。' }],
      acceptance: [], assignments: [],
    },
  ]
}

/** 长内容：真实长度的要求句，用来量正文换行。 */
function longTasks() {
  return [
    {
      id: 'tsk_long1',
      title: '把去年六月以来三套活跃口径的全部历史记录逐步统一成一套，并且在不丢来源的前提下重算 Q4 周报里的每一个数字',
      stage: 'needs_user',
      goal: '在不丢来源的情况下，把三套历史口径统一成一套可对外解释的标准，并重算 Q4 周报',
      scopeIn: [LONG_IDENTIFIER, 'Q4 周报口径对照（Atlas / Lumen / flagship-dashboard-v3）', '历史归档 · 2025-06 至今'],
      scopeOut: ['计费口径', '基础设施用量'],
      deliverable: '一页口径对照说明 + 修订后的周报 + 重算脚本的落点记录',
      defVersion: 6, executedVersion: 5, ago: 4,
      requirements: [
        {
          id: 'rl1', version: 6, state: 'active',
          statement: '活跃口径默认按 30 天窗口计算。7 天窗口只在 Lumen 侧单独标注，不能并入正文；如果某一份材料同时出现两个数，就在差异页并列写出来，并各附一句来源说明，不要在正文里二选一。',
        },
        { id: 'rl2', version: 5, state: 'superseded', statement: '先用 7 天窗口统计，30 天另附一页，正文里不出现具体数字。' },
        { id: 'rl3', version: 5, state: 'active', statement: '差异页保留两套计算方式，并写明各自适用场景与回指来源。' },
      ],
      acceptance: [
        { id: 'cl1', statement: '周报正文不再出现两套活跃数字，且每个数字都能回指到具体来源与版本' },
        { id: 'cl2', statement: '差异页对两套口径各有一句来源说明，说明里包含窗口定义与计算方式' },
        { id: 'cl3', statement: `重算脚本落在 ${LONG_IDENTIFIER}，并保留一次可复跑的命令` },
      ],
      assignments: [
        { version: 5, sessionId: 'ses_a91c4f0b7', state: 'running' },
        { version: 3, sessionId: 'ses_44b0e19d2', state: 'completed' },
      ],
      requiresUserFor: '同一指标在三份材料里给出了三个不同数字；如果按一套口径统一，其中一份就要改口，需要你决定改哪一份。',
    },
    {
      id: 'tsk_long2', title: 'Q4 周报口径对照（Atlas / Lumen）：差异页保留两套口径并逐条回指来源',
      stage: 'candidate_result',
      goal: '生成可以直接对外的 Q4 周报', scopeIn: ['Q4 周报草稿'], scopeOut: [], deliverable: '周报 v3（对外版）',
      defVersion: 2, executedVersion: 2, ago: 11,
      requirements: [{ id: 'rl4', version: 2, state: 'active', statement: '正文只保留一套活跃口径，差异页保留两套并注明来源。' }],
      acceptance: [{ id: 'cl4', statement: '每个数字都能回指到一个来源', outcome: 'met' }],
      assignments: [{ version: 2, sessionId: 'ses_44b0e', state: 'completed' }],
    },
    {
      id: 'tsk_long3', title: 'Atlas 与 Lumen 数据口径统一', stage: 'running',
      goal: '两个看板对同一指标给出同一个数', scopeIn: ['Atlas 看板', 'Lumen 看板'], scopeOut: [],
      deliverable: '统一后的口径说明', defVersion: 4, executedVersion: 4, ago: 2,
      requirements: [{ id: 'rl5', version: 4, state: 'active', statement: '先统一 30 天口径，差异页单独留着，不并入正文。' }],
      acceptance: [], assignments: [{ version: 4, sessionId: 'ses_a91c4', state: 'running' }],
    },
  ]
}

function extremeTasks(tasks) {
  const next = tasks.map(task => ({ ...task }))
  next[0].title = EXTREME
  next[0].requirements = next[0].requirements.map((requirement, index) => index === 0
    ? { ...requirement, statement: `${EXTREME} — 这一段没有空格，用来确认正文是换行还是被裁掉。` }
    : requirement)
  next[1].title = EXTREME
  next[2].goal = EXTREME
  next[3].title = 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'
  return next
}

/** 18 个任务：用来验证「条数跟着任务走」在满负荷下也成立。 */
function manyTasks(base, english) {
  const titles = english
    ? ['Atlas weekly window review', 'Lumen metric note attribution', 'Q4 budget difference page', 'Source citation batch review',
      'Both windows side by side', 'Weekly v3 pre-publish check', 'Recompute the comparison table', 'Historical archive citations',
      'Lumen activity window note', 'Atlas dashboard instrumentation review', 'Weekly figure consistency sweep', 'Billing window boundary note',
      'Infrastructure usage difference', 'Close out the Q4 review', 'Flagship dashboard window migration', 'Draft the window change notice',
      'Source permission review', 'Difference page sign-off']
    : ['Atlas 周报口径复核', 'Lumen 指标说明补来源', 'Q4 预算差异页', '来源引用批量核对',
      '差异页两套口径并置', '周报 v3 对外发布前检查', '口径对照表重算', '历史归档回指',
      'Lumen 活跃口径说明', 'Atlas 看板埋点核对', '周报数字一致性扫描', '计费口径边界说明',
      '基础设施用量差异', 'Q4 复盘结论收口', '旗舰看板口径迁移', '口径变更通知起草',
      '来源权限复核', '差异页签字放行']
  const stages = ['running', 'running', 'queued', 'queued', 'queued', 'ready', 'ready', 'intake',
    'needs_user', 'candidate_result', 'running', 'paused', 'ready', 'intake', 'running',
    'failed', 'ready', 'needs_user']
  const rest = titles.map((title, index) => ({
    id: `tsk_m${index}`, title, stage: stages[index],
    goal: title, scopeIn: ['Q4 周报草稿'], scopeOut: [], deliverable: '一页说明',
    defVersion: 1 + (index % 3), executedVersion: 1, ago: (index + 1) * 3,
    requirements: [{ id: `rm${index}`, version: 1, state: 'active', statement: '每个数字都要能回指来源。' }],
    acceptance: [], assignments: [],
  }))
  return [base[0], ...rest]
}

function deliverablesFor(scenario) {
  const english = state.lang === 'en'
  if (scenario === 'empty' || scenario === 'loading' || scenario === 'error' || scenario === 'offline' || scenario === 'one') return []
  if (scenario === 'long') {
    return english
      ? [
        { id: 'dl1', title: 'Q4 weekly draft (external) with both windows and per-figure attribution', revision: 'v3', size: '3.8 KB' },
        { id: 'dl2', title: LONG_IDENTIFIER, revision: 'v3', size: '12.4 KB' },
      ]
      : [
        { id: 'dl1', title: 'Q4 周报草稿（对外版）· 含差异页两套口径与逐条来源回指', revision: 'v3', size: '3.8 KB' },
        { id: 'dl2', title: LONG_IDENTIFIER, revision: 'v3', size: '12.4 KB' },
      ]
  }
  return english
    ? [
      { id: 'dl1', title: 'Q4 weekly draft', revision: 'v3', size: '3.8 KB' },
      { id: 'dl2', title: 'Q4 window comparison.md', revision: 'v3', size: '2.1 KB' },
      { id: 'dl3', title: 'Difference page sources.csv', revision: 'v1', size: '640 B' },
    ]
    : [
      { id: 'dl1', title: 'Q4 周报草稿', revision: 'v3', size: '3.8 KB' },
      { id: 'dl2', title: 'Q4 口径对照.md', revision: 'v3', size: '2.1 KB' },
      { id: 'dl3', title: '差异页来源清单.csv', revision: 'v1', size: '640 B' },
    ]
}

function scheduling(tasks) {
  return {
    occupied: tasks.filter(task => ['running', 'stopping'].includes(task.stage)).length,
    capacity: 18,
    queued: tasks.filter(task => task.stage === 'queued').length,
    paused: tasks.filter(task => task.stage === 'paused').length,
  }
}

/** 一次读取：面板要回答的全部事实。 */
function snapshot() {
  const scenario = state.scenario
  if (scenario === 'empty' || scenario === 'loading' || scenario === 'error' || scenario === 'offline') {
    return { status: scenario, tasks: [], deliverables: [], scheduling: { occupied: 0, capacity: 18, queued: 0, paused: 0 } }
  }
  const english = state.lang === 'en'
  const base = baseTasks({ english })
  const tasks = scenario === 'one' ? base.slice(0, 1)
    : scenario === 'long' ? longTasks()
      : scenario === 'overflow' ? extremeTasks(base)
        : scenario === 'many' ? manyTasks(base, english)
          : base
  return { status: 'ready', tasks, deliverables: deliverablesFor(scenario), scheduling: scheduling(tasks) }
}

/* ── 共享片段 ──────────────────────────────────────────────────────── */
function panelHead(data) {
  const text = copy()
  const load = data.scheduling
  const parts = [t('capacity', load)]
  if (load.queued) parts.push(`${text.inQueue} ${load.queued}`)
  if (load.paused) parts.push(`${text.paused} ${load.paused}`)
  return `<div class="phead">
    <div class="phead-id">
      <h2 class="ptitle">${escapeHtml(text.panel)}</h2>
      <p class="psub">${data.status === 'offline'
        ? escapeHtml(text.offline)
        : `<span class="num">${escapeHtml(parts.join(' · '))}</span>`}</p>
    </div>
    <div class="phead-tools">
      <button class="icon-btn" data-act="refresh" aria-label="${escapeHtml(text.refresh)}" title="${escapeHtml(text.refresh)}" aria-busy="${data.status === 'loading'}">↻</button>
      <button class="icon-btn" data-act="close" aria-label="${escapeHtml(text.close)}" title="${escapeHtml(text.close)}">✕</button>
    </div>
  </div>`
}

function emptyState(data) {
  const text = copy()
  if (data.status === 'loading') {
    return `<div class="skeleton" role="status" aria-label="${escapeHtml(text.loading)}"><i></i><i></i><i></i><i></i></div>`
  }
  if (data.status === 'error') {
    return `<div class="note" role="alert"><strong>${escapeHtml(text.errorRead)}</strong>
      <button class="btn btn-outline" data-act="refresh">${escapeHtml(text.retry)}</button></div>`
  }
  return `<div class="note"><strong>${escapeHtml(text.empty)}</strong></div>`
}

function actionButtons(task) {
  const text = copy()
  const busy = state.busy === task.id
  const attributes = `data-act="command" data-task="${task.id}" ${busy ? 'aria-busy="true" disabled' : ''}`
  return actionsFor(task).map(action => {
    const label = escapeHtml(text[action] ?? action)
    const testid = `data-testid="focus-${action}"`
    if (action === 'accept') return `<button class="btn btn-primary" data-command="accept" ${attributes} ${testid}>${label}</button>`
    if (action === 'terminate') return `<button class="btn btn-outline btn-danger" data-command="terminate" ${attributes} ${testid}>${label}</button>`
    return `<button class="btn btn-outline" data-command="${action}" ${attributes} ${testid}>${label}</button>`
  }).join('')
}

function facts(task) {
  const text = copy()
  const scope = [...task.scopeIn, ...task.scopeOut.map(item => `−${item}`)]
  return `<dl class="kv">
    <dt>${escapeHtml(text.goal)}</dt><dd>${escapeHtml(task.goal)}</dd>
    <dt>${escapeHtml(text.scope)}</dt><dd>${scope.length ? escapeHtml(scope.join('；')) : '—'}</dd>
    ${task.deliverable ? `<dt>${escapeHtml(text.deliverable)}</dt><dd>${escapeHtml(task.deliverable)}</dd>` : ''}
  </dl>`
}

function requirementList(task) {
  const text = copy()
  if (!task.requirements.length) return `<p class="empty-line">${escapeHtml(text.noReq)}</p>`
  return task.requirements.map(requirement => `<div class="req" data-state="${requirement.state}">
    <span class="req-tag"><span class="tag">v${requirement.version}</span></span>
    <span class="req-body">
      <span class="req-text">${escapeHtml(requirement.statement)}</span>
      <span class="req-note">${escapeHtml(t(`reqState.${requirement.state}`))}</span>
    </span>
  </div>`).join('')
}

function criteriaList(task) {
  if (!task.acceptance.length) return ''
  return `<ul class="crit">${task.acceptance.map(criterion => `<li class="crit" data-outcome="${criterion.outcome ?? 'pending'}">
    <span class="crit-glyph">${criterion.outcome === 'met' ? '✓' : criterion.outcome === 'gap' ? '!' : '·'}</span>
    <span class="crit-text">${escapeHtml(criterion.statement)}</span>
    <span class="crit-state">${escapeHtml(t(`outcome.${criterion.outcome ?? 'pending'}`))}</span>
  </li>`).join('')}</ul>`
}

function assignmentList(task) {
  const text = copy()
  if (!task.assignments.length) return `<p class="empty-line">${escapeHtml(text.noAssign)}</p>`
  return task.assignments.map(assignment => `<div class="assign">
    <span><span class="tag">v${assignment.version}</span></span>
    <span class="assign-session">${escapeHtml(assignment.sessionId)}</span>
    <span class="assign-state">${escapeHtml(t(`assignState.${assignment.state}`))}</span>
  </div>`).join('')
}

/* ── 档位条：一根条 = 一个任务，条即切换器 ────────────────────────
   现状是「18 个固定容量方块」+「任务标题条」两套东西在说同一件事，
   而容量条常常把标题条挤到 0px。合成一条后：条数 = 任务数，形状 =
   状态，点条即聚焦。容量作为文字留在副标题。 */
function gauge(taskList, selected) {
  const text = copy()
  const bars = taskList.filter(GAUGED)
  return `<div class="gauge">
    <div class="gauge-set" role="group" aria-label="${escapeHtml(text.inFlight)}">
      ${bars.map(task => `<button type="button" class="bar" data-act="select" data-task="${task.id}"
        data-tone="${TONE[task.stage]}" data-stage="${task.stage}"
        aria-current="${task.id === selected}"
        aria-label="${escapeHtml(t('barAria', { title: task.title, stage: stageLabel(task.stage) }))}"></button>`).join('')}
    </div>
    <span class="gauge-legend" aria-hidden="true">
      <span><i data-tone="needs"></i>${escapeHtml(text.stages.needs_user)}</span>
      <span><i data-tone="active"></i>${escapeHtml(text.stages.running)}</span>
      <span data-kind="extra"><i data-tone="idle"></i>${escapeHtml(text.inQueue)}</span>
    </span>
  </div>
  <div class="gauge-caption">
    ${stageMark(taskList.find(task => task.id === selected)?.stage ?? 'intake')}
    <span class="gauge-name">${escapeHtml(taskList.find(task => task.id === selected)?.title ?? '')}</span>
    <span class="gauge-count">${escapeHtml(t('taskCount', { count: bars.length }))}</span>
  </div>`
}

/* ── 产物：两块承载面共用 ─────────────────────────────────────────── */
function filesBlock(deliverables) {
  const text = copy()
  return `<div class="rail-block">
    <h3 class="rail-head">${escapeHtml(text.deliverables)}<span>${deliverables.length}</span></h3>
    ${deliverables.length
      ? deliverables.map(file => `<button class="file" data-act="preview" data-name="${escapeHtml(file.title)}">
          <span class="file-name">${escapeHtml(file.title)}</span>
          <span class="file-tag">${escapeHtml(file.revision)}</span>
        </button>`).join('')
      : `<p class="empty-line">—</p>`}
  </div>`
}

/* ── 记录主体：两块承载面共用同一份内容 ───────────────────────────── */
function recordBody(task) {
  const text = copy()
  if (!task) return `<div class="note"><strong>${escapeHtml(text.empty)}</strong></div>`
  return `<div class="heading">
      <h3 class="title">${escapeHtml(task.title)}</h3>
      <div class="heading-meta">
        ${stageMark(task.stage)}
        <span class="tag">${escapeHtml(t('version', { version: task.defVersion }))}</span>
        ${task.executedVersion !== undefined && task.executedVersion !== task.defVersion
    ? `<span class="tag" data-tone="active">${escapeHtml(t('executed', { version: task.executedVersion }))}</span>` : ''}
        ${task.blocked ? `<span class="tag">${escapeHtml(text.inQueue)}</span>` : ''}
        <span class="crit-state">${escapeHtml(agoLabel(task.ago))}</span>
      </div>
    </div>

    ${task.requiresUserFor ? `<div class="asked">
      <span class="asked-label">${escapeHtml(text.askedLabel)}</span>
      ${escapeHtml(task.requiresUserFor)}
    </div>` : ''}

    <div class="sec-head">${escapeHtml(text.requirements)}<span>${task.requirements.length}</span></div>
    ${requirementList(task)}

    ${task.acceptance.length ? `<div class="sec-head">${escapeHtml(text.acceptance)}<span>${task.acceptance.length}</span></div>
      ${criteriaList(task)}` : ''}

    <div class="sec-head">${escapeHtml(text.definition)}</div>
    ${facts(task)}

    <div class="sec-head">${escapeHtml(text.assignments)}<span>${task.assignments.length}</span></div>
    ${assignmentList(task)}`
}

/* ── 优化后 · 标题栏 peek：两栏（左记录、右产物）────────────────── */
function renderPeek(data) {
  const text = copy()
  if (data.status !== 'ready') {
    return `<div class="panel" data-version="optimized" data-surface="peek">${panelHead(data)}<div class="record">${emptyState(data)}</div></div>`
  }
  const { tasks, deliverables, scheduling: load } = data
  const selected = tasks.some(task => task.id === state.selected) ? state.selected : initialFocus(tasks)
  const task = tasks.find(item => item.id === selected)
  const inFlight = tasks.filter(GAUGED)
  return `<div class="panel" data-version="optimized" data-surface="peek">
    ${panelHead(data)}
    ${gauge(tasks, selected)}
    <div class="peek-body">
      <div class="peek-left">
        <div class="surface">
          <div class="record">${recordBody(task)}</div>
          <div class="actions">
            ${actionButtons(task) || `<span class="crit-state">${escapeHtml(stageLabel(task.stage))}</span>`}
            <span class="spacer"></span>
            <button class="btn btn-ghost" data-act="open-task" data-task="${task?.id ?? ''}">${escapeHtml(text.openTask)}</button>
          </div>
        </div>
      </div>
      <aside class="rail" aria-label="${escapeHtml(text.deliverables)}">
        <div class="rail-block">
          <h3 class="rail-head">${escapeHtml(text.inFlight)}<span>${inFlight.length}</span></h3>
          <div class="rail-list">${inFlight.length
            ? inFlight.map(item => `<button class="rail-row" data-act="select" data-task="${item.id}" aria-current="${item.id === selected}">
                <span class="rail-dot" data-tone="${TONE[item.stage]}" aria-hidden="true"></span>
                <span class="rail-body">
                  <span class="rail-title">${escapeHtml(item.title)}</span>
                  <span class="rail-state">${escapeHtml(stageLabel(item.stage))}</span>
                </span>
              </button>`).join('')
            : `<p class="empty-line">—</p>`}</div>
        </div>
        ${filesBlock(deliverables)}
      </aside>
    </div>
  </div>`
}

/* ── 优化后 · 助手侧边栏：紧贴右侧、自上而下纵向单栏 ─────────────── */
function renderDock(data) {
  const text = copy()
  if (data.status !== 'ready') {
    return `<div class="panel" data-version="optimized" data-surface="dock">${panelHead(data)}<div class="dock-scroll">${emptyState(data)}</div></div>`
  }
  const { tasks, deliverables } = data
  const selected = tasks.some(task => task.id === state.selected) ? state.selected : initialFocus(tasks)
  const task = tasks.find(item => item.id === selected)
  return `<div class="panel" data-version="optimized" data-surface="dock">
    ${panelHead(data)}
    ${gauge(tasks, selected)}
    <div class="dock-body">
      <!-- 纵向：记录是主体，占满剩余高度并自己滚动。 -->
      <div class="dock-scroll">${recordBody(task)}</div>
      <!-- 产物与动作贴在底部：它们是「这次任务的出口」，不随正文滚走。 -->
      ${deliverables.length ? `<div class="dock-rail">${filesBlock(deliverables)}</div>` : ''}
      <div class="actions">
        ${actionButtons(task) || `<span class="crit-state">${escapeHtml(stageLabel(task?.stage ?? 'intake'))}</span>`}
        <span class="spacer"></span>
        <button class="btn btn-ghost" data-act="open-task" data-task="${task?.id ?? ''}">${escapeHtml(text.openTask)}</button>
      </div>
    </div>
  </div>`
}

/* ── 现状复刻：结构与 focus-board.css 一比一 ──────────────────────── */
function renderCurrent(data) {
  const text = copy()
  const surface = state.surface
  if (data.status !== 'ready') {
    return `<div class="panel" data-version="current" data-surface="${surface}">${panelHead(data)}<div class="cur-record">${emptyState(data)}</div></div>`
  }
  const { tasks, deliverables, scheduling: load } = data
  const selected = tasks.some(task => task.id === state.selected) ? state.selected : initialFocus(tasks)
  const task = tasks.find(item => item.id === selected)
  const segments = tasks.filter(GAUGED)
  const seats = Math.max(load.capacity, load.occupied)
  return `<div class="panel" data-version="current" data-surface="${surface}">
    ${panelHead(data)}
    <!-- 现状：18 个固定方块 + 任务标题条，两套东西说同一件事 -->
    <div class="cur-strip" role="tablist" aria-label="${escapeHtml(text.inFlight)}">
      <span class="cur-readout">
        <span class="cur-seats" aria-hidden="true">${Array.from({ length: seats }, (_, index) =>
    `<span class="cur-seat" data-on="${index < load.occupied}"></span>`).join('')}</span>
        <span class="cur-count">${escapeHtml(t('capacity', load))}</span>
      </span>
      <div class="cur-segments">${segments.map(segment => `<button class="cur-segment" role="tab"
          aria-selected="${segment.id === selected}" data-act="select" data-task="${segment.id}" data-tone="${TONE[segment.stage]}">
          <span class="cur-segment-dot" aria-hidden="true"></span>
          <span class="cur-segment-title">${escapeHtml(segment.title)}</span>
        </button>`).join('')}</div>
      <button class="icon-btn" data-act="refresh" aria-label="${escapeHtml(text.refresh)}" title="${escapeHtml(text.refresh)}">↻</button>
    </div>
    <div class="cur-board" data-surface="${surface}">
      <div class="cur-left">
        ${task ? `<div class="cur-surface">
          <div class="cur-record">
            <div class="cur-heading">
              <h3 class="cur-title">${escapeHtml(task.title)}</h3>
              <span class="cur-stage">${escapeHtml(stageLabel(task.stage))}</span>
            </div>
            <h4 class="cur-label">${escapeHtml(text.requirements)}</h4>
            ${task.requirements.length ? task.requirements.map(requirement => `<div class="cur-version" data-state="${requirement.state}">
              <span class="cur-version-tag">v${requirement.version}</span>
              <span class="cur-version-text">${escapeHtml(requirement.statement)}</span>
              <span class="cur-version-state">${escapeHtml(t(`reqState.${requirement.state}`))}</span>
            </div>`).join('') : `<p class="empty-line">${escapeHtml(text.noReq)}</p>`}
            <h4 class="cur-label">${escapeHtml(text.definition)}</h4>
            <dl class="cur-facts">
              <dt>${escapeHtml(text.goal)}</dt><dd>${escapeHtml(task.goal)}</dd>
              <dt>${escapeHtml(text.scope)}</dt>
              <dd>${escapeHtml([...task.scopeIn, ...task.scopeOut.map(item => `−${item}`)].join('；') || '—')}</dd>
              ${task.deliverable ? `<dt>${escapeHtml(text.deliverable)}</dt><dd>${escapeHtml(task.deliverable)}</dd>` : ''}
            </dl>
            <h4 class="cur-label">${escapeHtml(text.assignments)}</h4>
            ${task.assignments.length ? task.assignments.map(assignment => `<div class="cur-version">
              <span class="cur-version-tag">v${assignment.version}</span>
              <span class="cur-version-text">${escapeHtml(assignment.sessionId)}</span>
              <span class="cur-version-state">${escapeHtml(t(`assignState.${assignment.state}`))}</span>
            </div>`).join('') : `<p class="empty-line">${escapeHtml(text.noAssign)}</p>`}
            ${task.acceptance.length ? `<h4 class="cur-label">${escapeHtml(text.acceptance)}</h4>
              <ul class="crit" style="list-style:none;padding:0">${task.acceptance.map(criterion => `<li class="crit" data-outcome="${criterion.outcome ?? 'pending'}" style="border:0;padding:3px 0">
                <span class="crit-text" style="font-size:var(--type-micro)">${escapeHtml(criterion.statement)}</span>
                <span class="cur-version-state">${escapeHtml(t(`outcome.${criterion.outcome ?? 'pending'}`))}</span>
              </li>`).join('')}</ul>` : ''}
          </div>
          <div class="cur-actions">
            ${actionButtons(task)}
            <span class="crit-state" style="margin-left:auto">${escapeHtml(text.openTask)}</span>
          </div>
        </div>` : `<div class="note"><strong>${escapeHtml(text.empty)}</strong></div>`}
      </div>
      <aside class="cur-rail">
        <div>
          <h4 class="cur-rail-head">${escapeHtml(text.inFlight)}<span class="num">${segments.length}</span></h4>
          ${segments.map(segment => `<button class="cur-rail-row" data-act="select" data-task="${segment.id}">
            <span class="cur-rail-dot" data-tone="${TONE[segment.stage]}" aria-hidden="true"></span>
            <span class="cur-rail-title">${escapeHtml(segment.title)}</span>
            <span class="cur-rail-state">${escapeHtml(stageLabel(segment.stage))}</span>
          </button>`).join('')}
        </div>
        <div style="padding-top:8px;border-top:1px solid var(--border)">
          <h4 class="cur-rail-head">${escapeHtml(text.deliverables)}<span class="num">${deliverables.length}</span></h4>
          ${deliverables.slice(0, 5).map(file => `<button class="cur-rail-file" data-act="preview" data-name="${escapeHtml(file.title)}">
            <span class="cur-rail-file-name">${escapeHtml(file.title)}</span>
          </button>`).join('')}
        </div>
      </aside>
    </div>
  </div>`
}

/* ── 渲染与交互 ───────────────────────────────────────────────────── */
const RENDER = {
  optimized: data => (state.surface === 'dock' ? renderDock(data) : renderPeek(data)),
  current: renderCurrent,
}

function stageSurface() {
  const stage = $('#stage')
  stage.dataset.surface = state.surface
  $('#stage-label').textContent = state.surface === 'dock'
    ? '助手视图 · 点「更多」打开的悬浮侧边面板（靠右浮动，四周留边）'
    : '标题栏 · 助手入口悬停 / 点击出现的浮层'
  $('#host').dataset.surface = state.surface
  $('#host').className = `host`
  $('#frame-note').dataset.surface = state.surface
}

function focusIdentity() {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !active.closest('#host')) return null
  const node = active.closest('[data-act]')
  return node ? { act: node.dataset.act, task: node.dataset.task ?? '' } : null
}

function restoreFocus(identity) {
  if (!identity) return
  const candidates = [...$('#host').querySelectorAll(`[data-act="${identity.act}"]`)]
    .filter(node => node.getClientRects().length > 0)
  const match = candidates.find(node => (node.dataset.task ?? '') === identity.task) ?? candidates[0]
  if (match instanceof HTMLElement) match.focus({ preventScroll: true })
}

function frameNote() {
  if (state.version === 'current') return copy().noteCurrent
  return state.surface === 'dock' ? copy().noteDock : copy().notePeek
}

function render({ keepFocus = true } = {}) {
  const identity = keepFocus ? focusIdentity() : null
  const data = snapshot()
  stageSurface()
  const host = $('#host')
  host.innerHTML = RENDER[state.version](data)
  $('#frame-note').innerHTML = frameNote()

  if (state.notice) {
    const toast = document.createElement('div')
    toast.className = 'notice'
    toast.setAttribute('role', 'status')
    toast.textContent = state.notice
    host.querySelector('.panel')?.appendChild(toast)
    state.notice = undefined
  }
  restoreFocus(identity)
}

const taskById = id => snapshot().tasks.find(task => task.id === id)

function emitNotice(message) {
  state.notice = message
  render({ keepFocus: false })
}

function command(action, taskId) {
  const task = taskById(taskId)
  if (!task || state.busy) return
  const label = copy()[action] ?? action
  state.busy = taskId
  render()
  window.setTimeout(() => {
    state.busy = undefined
    const title = task.title.length > 24 ? `${task.title.slice(0, 24)}…` : task.title
    emitNotice(`${label} · ${title}`)
  }, 360)
}

document.addEventListener('click', event => {
  const node = event.target instanceof Element ? event.target.closest('[data-act]') : null
  if (!node) return
  const { act, task, name, command: action } = node.dataset
  if (act === 'select') {
    state.selected = task
    render()
  } else if (act === 'command') command(action, task)
  else if (act === 'refresh') emitNotice(copy().loading)
  else if (act === 'close') emitNotice(copy().close)
  else if (act === 'open-task') emitNotice(`${copy().openTask} · ${task}`)
  else if (act === 'preview') emitNotice(name)
})

/** 键盘：↑↓ 在档位条与列表之间移动；档位条是 group + roving focus。 */
document.addEventListener('keydown', event => {
  const host = $('#host')
  if (!host || !host.contains(document.activeElement)) return
  const focused = document.activeElement
  if (!(focused instanceof HTMLElement)) return
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  const order = [...host.querySelectorAll('[data-act="select"]')].filter(node => node.getClientRects().length > 0)
  const index = order.indexOf(focused)
  if (index < 0) return
  event.preventDefault()
  const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1
  order[Math.min(order.length - 1, Math.max(0, index + step))]?.focus()
})

/* ── 控制栏 ───────────────────────────────────────────────────────── */
function syncControls() {
  document.documentElement.dataset.theme = state.theme
  document.querySelectorAll('.proto-pill').forEach(pill => {
    const pressed = pill.dataset.surface ? pill.dataset.surface === state.surface
      : pill.dataset.version ? pill.dataset.version === state.version
        : pill.dataset.scenario === state.scenario
    pill.setAttribute('aria-pressed', String(pressed))
  })
  $('#theme-toggle').textContent = state.theme === 'dark' ? '☀' : '☾'
  $('#theme-toggle').setAttribute('aria-label', state.theme === 'dark' ? '切换浅色模式' : '切换深色模式')
  $('#lang-toggle').textContent = state.lang === 'zh' ? 'EN' : '中'
  document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en'
  document.title = state.lang === 'zh' ? 'Phaneris · 助手 Focus 面板优化' : 'Phaneris · Assistant focus panel'
}

function wire(selector, key, attribute) {
  document.querySelectorAll(selector).forEach(pill => {
    pill.addEventListener('click', () => {
      state[key] = pill.dataset[attribute]
      state.selected = undefined
      syncControls()
      render({ keepFocus: false })
    })
  })
}
wire('.proto-pill[data-surface]', 'surface', 'surface')
wire('.proto-pill[data-version]', 'version', 'version')
wire('.proto-pill[data-scenario]', 'scenario', 'scenario')

$('#theme-toggle').addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark'
  syncControls()
})
$('#lang-toggle').addEventListener('click', () => {
  state.lang = state.lang === 'zh' ? 'en' : 'zh'
  syncControls()
  render({ keepFocus: false })
})
$('#notes-open').addEventListener('click', () => $('#notes').showModal())
$('#notes-close').addEventListener('click', () => $('#notes').close())

/* 深链接：?surface=peek|dock&version=current|optimized&theme=&lang=&state=&select= */
const url = new URLSearchParams(location.search)
if (['peek', 'dock'].includes(url.get('surface'))) state.surface = url.get('surface')
if (RENDER[url.get('version')]) state.version = url.get('version')
if (['light', 'dark'].includes(url.get('theme'))) state.theme = url.get('theme')
if (['zh', 'en'].includes(url.get('lang'))) state.lang = url.get('lang')
if (['ready', 'one', 'long', 'overflow', 'many', 'empty', 'loading', 'error', 'offline'].includes(url.get('state'))) state.scenario = url.get('state')
if (url.get('select')) state.selected = url.get('select')

syncControls()
render({ keepFocus: false })
