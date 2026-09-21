import { readFileSync, writeFileSync } from 'node:fs'

// Read-only source inventory. The only output is this audit's JSON manifest.
// Supply the rg file list via stdin, and the commit as argv[2]. No child process needed.
const paths = readFileSync(0, 'utf8').trim().split(/\r?\n/)
const visual = paths.filter(p => /\.(tsx|css|html)$/.test(p) && !p.replaceAll('\\', '/').includes('/resources/'))
const categories = {
  motion: /motion\.|AnimatePresence|MotionConfig|useReducedMotion|useSpring|useAnimate/,
  css: /@keyframes|animation\s*:|transition\s*:|\b(?:animate|transition|duration|ease)-/,
  scroll: /scrollIntoView\(|scrollTo\(/,
  timing: /requestAnimationFrame\(|\.animate\(|onExitComplete|onAnimationComplete/,
  reduced: /prefers-reduced-motion|useReducedMotion|reducedMotion/,
}
const files = visual.map(p => {
  const path = p.replaceAll('\\', '/')
  const lines = readFileSync(p, 'utf8').split(/\r?\n/)
  const hits = Object.fromEntries(Object.entries(categories).map(([key, re]) => [key, lines.flatMap((line, i) => re.test(line) ? [i + 1] : [])]))
  const area = path.startsWith('apps/electron/src/renderer/playground') ? 'playground'
    : path.startsWith('apps/electron/') ? 'electron'
    : path.startsWith('packages/ui/') ? 'shared-ui'
    : path.startsWith('apps/webui/') ? 'webui'
    : path.startsWith('apps/viewer/') ? 'viewer' : 'design-artifacts'
  return { path, area, lines: lines.length, hits }
})
const supplementalPaths = paths.filter(p => /\.(ts|tsx|css|html)$/.test(p) && !visual.includes(p) && !p.replaceAll('\\', '/').includes('/resources/'))
const supplemental = supplementalPaths.flatMap(p => {
  const lines = readFileSync(p, 'utf8').split(/\r?\n/)
  const hits = lines.flatMap((line, i) => /scrollIntoView\(|scrollTo\(|requestAnimationFrame\(|@keyframes|animation\s*:|transition\s*:|prefers-reduced-motion/.test(line) ? [i + 1] : [])
  return hits.length ? [{ path: p.replaceAll('\\', '/'), hits }] : []
})
const counts = Object.fromEntries([...new Set(files.map(f => f.area))].map(area => [area, files.filter(f => f.area === area).length]))
const report = {
  date: '2026-09-21',
  commit: process.argv[2] ?? 'unknown',
  scope: 'rg-visible TSX/CSS/HTML under apps, packages, docs and hero-demo; resources excluded as bundled third-party/user artifacts. Supplemental TS scan includes motion mechanisms outside visual components. Hits are discovery candidates, not findings or proof of manual review.',
  counts, totalVisualFiles: files.length, supplementalScanned: supplementalPaths.length,
  files, supplemental,
}
writeFileSync('plans/motion-audit-inventory.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ commit: report.commit, counts, totalVisualFiles: files.length, supplementalScanned: supplementalPaths.length, supplementalCandidates: supplemental.length }))
