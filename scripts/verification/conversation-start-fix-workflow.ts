/** Cross-platform entry point; each workflow produces its own verifiable manifest. */
for (const workflow of ['conversation-startup-diagnostic', 'conversation-browser-settlement', 'conversation-thinking-client', 'pi-interruption-recovery']) {
  const child = Bun.spawn([process.execPath, 'run', `${import.meta.dir}/${workflow}-workflow.ts`], {
    cwd: `${import.meta.dir}/../..`, env: { ...process.env, PHANERIS_VERIFY_THINKING: '1' }, stdout: 'inherit', stderr: 'inherit',
  })
  const code = await child.exited
  if (code !== 0) process.exit(code)
}
export {}
