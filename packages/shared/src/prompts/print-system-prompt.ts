#!/usr/bin/env bun
/** Inspect exact assembled sections. Examples are not captured provider requests. */
import { compileSystemPrompt, getDateTimeContext, getWorkingDirectoryContext } from './system.ts';
import { formatSessionState } from '../agent/mode-manager.ts';
import { formatTaskContext } from './task-context.ts';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
if (args.some(arg => !['--json', '--include-content'].includes(arg)) || (args.includes('--include-content') && !args.includes('--json'))) {
  throw new Error('Usage: bun run print:system-prompt [--json [--include-content]]');
}
const workspace = '/Users/example/.phaneris/workspaces/abc123';
const sessionId = 'example-session';
const compiled = compileSystemPrompt({ debugMode: { enabled: false }, workspaceRootPath: workspace });
const sha256 = (content: string) => createHash('sha256').update(content).digest('hex');
const includeContent = args.includes('--include-content');
const scope = 'Example system prefix; not a captured provider request. Counts are characters/UTF-8 bytes, not billed tokens.';
const summary = {
  schemaVersion: 1, scope, sha256: sha256(compiled.text), characters: compiled.text.length, bytes: Buffer.byteLength(compiled.text),
  ...(includeContent ? { text: compiled.text } : {}),
  sections: compiled.sections.map(section => ({ id: section.id, source: section.source,
    characters: section.content.length, bytes: Buffer.byteLength(section.content), sha256: sha256(section.content),
    ...(includeContent ? { content: section.content } : {}) })),
};
if (args.includes('--json')) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const section = (title: string, content: string) => console.log('\n' + '='.repeat(80) + '\n' + title + '\n' + '='.repeat(80) + '\n' + content);
console.log(scope);
section('ASSEMBLED SYSTEM PREFIX', compiled.text);
section('SECTION PROVENANCE AND BUDGET', summary.sections.map(part =>
  part.id + ' | ' + part.source + ' | ' + part.characters + ' characters | ' + part.bytes + ' bytes | ' + part.sha256).join('\n'));

section('STABLE ADDITIONS IN Pi', [
  'PiAgent appends workspace capabilities, working directory and stable repository identity to the system prefix.',
  'The following working-directory example belongs there, not in the user-message tail:',
  getWorkingDirectoryContext('/Users/example/projects/my-app', false) ?? '(none)',
].join('\n\n'));

section('VOLATILE USER TAIL EXAMPLES', [
  'These use example IDs and paths. They are not the state of an active user session.',
  getDateTimeContext(),
  formatSessionState(sessionId, {
    plansFolderPath: workspace + '/sessions/' + sessionId + '/plans',
    dataFolderPath: workspace + '/sessions/' + sessionId + '/data',
    consumeModeChangeUserSignal: false,
  }),
  formatTaskContext({ id: sessionId, name: 'Example report', description: 'Produce the requested report',
    acceptanceCriteria: 'References are verifiable', progress: 20 }),
  'Actual source state, volatile git status and an explicitly selected plugin also ride this tail when present.',
  'Attachments and the actual user message follow. Skill directives appear only after explicit invocation.',
].filter(Boolean).join('\n\n'));

section('OWNERSHIP', [
  'prompts/assistant-contract.ts: identity, execution, permissions and completion.',
  'prompts/capability-guidance.ts: capability routing and product workflows.',
  'prompts/system.ts: host facts, preferences, project/debug blocks, environment and ordered assembly.',
  'agent/core/prompt-builder.ts: stable/volatile context placement; consumes the one-shot mode signal only on the real turn path.',
  'agent/pi-agent.ts: actual system prompt, user tail and provider request path.',
  'For real request evidence, run bun run verify:model-harness and inspect its verification artifacts.',
].join('\n'));
