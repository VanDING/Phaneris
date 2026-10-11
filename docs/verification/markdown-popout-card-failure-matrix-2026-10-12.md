# 对话与行为全屏预览卡片：事先失败矩阵（2026-10-12）

状态：MP01–MP12先于本次产品修复和浏览器工作流编写；修复后浏览器18/18通过。MP13在pre-push发现后、同步policy前补充。用户要求恢复图二的卡片呈现；源码查看应保留源码，普通阅读和行为详情应保留格式化内容。主题全局治理仍按独立方案执行。前后结果见[归档](results/markdown-popout-card-2026-10-12/README.md)。

| ID | 可能失败的方式 | 浏览器验收与证据 |
| --- | --- | --- |
| MP01 | 短消息、普通回复、回合或行为详情直接贴在整片画布上 | 四种实际popout状态驱动生产overlay；居中有限宽卡片，有独立底面、圆角和有效shadow，截图与DOM几何 |
| MP02 | “查看Markdown”路径丢失源码模式 | 真实popout状态标记source；Read/response.md/代码卡片与行号出现，原始Markdown符号完整保留 |
| MP03 | 恢复源码卡片误把所有消息变成源码 | formatted模式仍显示heading/bold/link等语义；source模式显示字面量，内容不丢失 |
| MP04 | 桌面宽度与窄pane只有一边恢复 | 1440px与1100px分别记录卡片位置、尺寸与截图；当前modalBreakpoint=99999，二者实际均为fullscreen，不冒充modal验收 |
| MP05 | light正确，dark卡片/代码不可读或不跟随切换 | 使用实际ThemeProvider/Shiki provider，打开source后切模式；卡片底面与高亮跟随、无旧light HTML残留 |
| MP06 | fitContent的850px minWidth把窄屏卡片撑出屏幕 | 390px测formatted与source；卡片在内容区内，长代码只在其内容区域横向滚动 |
| MP07 | 长正文或长源码的开头/尾部不可达，出现双重竖向滚动 | card随内容自然增长；外层paper scrolling可到首尾；记录滚动容器与首尾标记 |
| MP08 | close/Esc或切换另一条popout残留旧内容 | close按钮与Esc分别关闭；再次打开、替换状态显示新内容；记录焦点恢复 |
| MP09 | 普通Markdown链接/文件打开回调丢失 | 点击真实link与path，记录fixture callback；不请求外部服务 |
| MP10 | UI只改了展示，ChatDisplay源码入口仍不传source | 源码审查真实onPopOut调用、类型检查；fixture到生产状态/overlay的浏览器验收不冒充完整ChatDisplay或正式包验收 |
| MP11 | 回归修复重新引入已移除的Files/Opened面板 | 保持既有popout atom和Files三职责；定向源码审查，不恢复旧panel registry |
| MP12 | E2E结果不可重复、覆盖历史或缺截图/失败产物 | 沿用VerificationRun唯一输出，保存scenes、几何、错误、前后截图、manifest/SHA；保留修复前失败运行 |
| MP13 | 新critical workflow只登记执行registry，遗漏锁定policy，导致pre-push/CI拒绝 | 同步critical-scenarios.ts与critical-scenario-policy.json的id/entry/minimum/required；保持既有条目与门禁，check:governance和完整pre-push均必须通过 |

本轮真实服务、Electron正式包、原生窗口材质及三平台验收未闭环；本次可关闭的是状态到生产组件的浏览器视觉与交互路径。额外原生验收按主题治理的H矩阵继续执行。
