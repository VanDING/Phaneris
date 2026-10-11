#!/usr/bin/env bun
/** Both the smoke-test runner and PEP 723 tools use the product Python patch. */
import { TOOL_PYTHON_VERSION } from '../packages/session-tools-core/src/runtime/resolve-script-runtime'
const tests = ['pdf_tool_smoke', 'xlsx_tool_smoke', 'docx_tool_smoke', 'pptx_tool_smoke',
  'img_tool_smoke', 'ical_tool_smoke', 'doc_diff_smoke', 'markitdown_smoke']
const child = Bun.spawn(['uv', 'run', '--python', TOOL_PYTHON_VERSION, '--no-project', 'python', '-m', 'unittest',
  ...tests.map(name => `apps.electron.resources.scripts.tests.test_${name}`)], {
  cwd: `${import.meta.dir}/..`, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
})
process.exitCode = await child.exited
