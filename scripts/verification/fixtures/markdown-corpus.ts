/** A reviewable document corpus, including syntax the visual editor must not rewrite. */
export const COMPLEX_MARKDOWN = [
  '# 混合文档验收', '', '<!-- preserve provenance: fixture -->', '',
  '公式：$E=mc^2$；块级公式：', '', '$$', '\\int_0^1 x^2 \\,dx = \\frac{1}{3}', '$$', '',
  '```mermaid', 'flowchart LR', '  A[输入] --> B[审阅] --> C[接受]', '```', '',
  '- [x] 原始资料已保存', '- [ ] 待人工审阅', '',
  '[资料原文](https://example.invalid/report?source=fixture&revision=1#proof)', '',
  '![结构图](./diagram.png "保留图片引用")', '',
  '| 项目 | 状态 |', '| --- | --- |', '| 资料 | 已完成 |', '',
  '> 保留引用与中文。', '',
].join('\n')
