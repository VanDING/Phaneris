# 侧栏提示标签残留：验收

状态：本机验收通过。修复落在 `e27698d91` 的工作树（`LeftSidebar` 的轨道提示闩锁），源码改动、构建哈希与运行环境见 manifest。

[失败矩阵](../../sidebar-tooltip-residue-failure-matrix-2026-10-13.md)

## 问题

收起侧边栏时，左侧轨道会一次冒出多个本不该出现的提示标签（实机截图 7 个），且重复出现。

## 根因

`786bf6d08` 把 `LeftSidebar` 的 Tooltip 从"仅收起时挂载、非受控"改成"常驻、受控"：

```tsx
const [tooltipOpen, setTooltipOpen] = React.useState(false)
<Tooltip open={isCollapsed && tooltipOpen} onOpenChange={setTooltipOpen}>
```

展开态下受控值恒为 `false`，而 Radix 的 `useControllableState` 只在 `next !== prop` 时回调，于是指针移开（或焦点离开）触发的 `setValue(false)` 被丢弃，`tooltipOpen` 永久停在 `true`。收起瞬间所有被闩锁的行在同一次渲染里 `open === true`，一次性挂载各自的标签；指针不在这些触发器上，也没有 `TOOLTIP_OPEN` 派发，因此无人关闭，直到下一次点击/Esc/展开。

肉眼只看到顶层轨道行：子行由 `renderExpandedContent` 以 `isCollapsed={false}` 渲染，其提示永远不会挂载——与截图里恰好是那排图标一致。

修复：只允许**收起态**闩锁（`onOpenChange={next => setTooltipOpen(next && isCollapsed)}`），并且提示内容仅在收起时挂载（`{isCollapsed && <TooltipContent …/>}`）。Trigger 与按钮节点仍常驻，`786bf6d08` 的焦点与插值收益不变。

## 实测

真实 Electron 44 main/preload/renderer，一次性本地工作区；指针停在内容区、收起由键盘触发，排除"指针恰好在轨道上"的解释。

| 观察 | 修复前 | 修复后 |
| --- | --- | --- |
| 收起后挂载的提示节点（逐帧） | 5 个：所有会话 / 标签 / 数据源 / 技能 / 插件 | 0 |
| 悬停向量（顶层行 0–3，各停留 400ms） | 全部闩锁 | 不闩锁 |
| 焦点向量（顶层行 4） | 闩锁 | 不闩锁 |
| 收起态悬停轨道行 | 正常 | 恰好 1 个，文本等于该行 `aria-label` |
| 指针离开轨道 | 正常关闭 | 关闭，0 个 |
| 收起 → 展开 | 未测（前序断言失败） | 逐帧 0 |
| 工作流结果 | 断言失败，0 场景完成 | 68/68 场景、65/65 断言 |

## 证据

| 运行 | 结果 | 证据 |
| --- | --- | --- |
| 修复前 | 失败：1/37 断言 | [failure.json](before/failure.json) · [逐帧与文本](before/collapse-after-expanded-hover-focus-frames.json) · [选取说明](before/selection.json) · [原始 manifest](before/source-manifest.json) |
| 修复后 | 通过：68/68 | [manifest](after/manifest.json) · [逐帧与文本](after/collapse-after-expanded-hover-focus-frames.json) · [全部断言](after/shell-visual.json) |

`before/` 只归档选取的失败观察（该次运行在首个失败断言处中止，场景不完整），因此不构成通过验收；`after/` 为完整运行，可用下方命令复核。

复现（仓库根目录）：

```sh
bun run test:shell-visual
bun run scripts/verification/verification-artifacts.ts --verify=docs/verification/results/sidebar-tooltip-residue-2026-10-13/after
```

## 打包产物复核

同一源码经 `bun run electron:dist:dev:mac` 打成未签名 DMG/ZIP 后，直接在 `Phaneris.app` 内复跑同一场景（Playwright 启动打包二进制、一次性配置根，指针停在内容区、键盘收起）：

| 观察 | 结果 |
| --- | --- |
| 识别到的轨道行 | 8 个：所有会话 / 标签 / 数据源 / 技能 / 插件 / 项目 / 页面 / 自动化 |
| 悬停 0–3 并聚焦第 4 行后收起，25 帧内最大提示节点数 | 0 |
| 收起稳定后的提示节点 | 0 |
| 收起态悬停第 1 行 | 恰好 1 个，文本「标签」 |
| 指针离开轨道 | 0 |

[探针输出](packaged/probe.json) · [收起后的轨道截图](packaged/rail-after-collapse.png)

产物（macOS x64、未签名）：`Phaneris-0.3.1-mac-x64.dmg` 219,963,694 B，SHA-256 `b26f0149cf80c8ef6b8d944168951fcf79e75ad3a18b7a7b904cac3e9ffbd3ca`；`Phaneris-0.3.1-mac-x64.zip` 213,469,327 B，SHA-256 `5dd7539c47edbe35146071d9fcf1d3f065a0345b92b8d3a0894810289c01eda9`。结构 11/11、启动 smoke 5/5、安装件 4/4 通过，结果见 [packaged-client-verification.json](../packaged-client-verification.json) 与 [packaged-client-smoke.json](../packaged-client-smoke.json)。

范围：macOS 本机、真实 Electron 主进程/预加载/渲染进程，含未签名本地包；未覆盖 Windows/Linux 原生执行、签名安装器与实物触摸设备。视觉债务未新增，原 132 项档案保持原 SHA，本轮证据写独立目录。
