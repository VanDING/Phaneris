import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPhanerisResourceLoader, setPhanerisSystemPrompt } from './phaneris-resource-loader.ts';

describe('createPhanerisResourceLoader', () => {
  it('returns the Phaneris prompt via systemPromptOverride after reload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-loader-'));
    setPhanerisSystemPrompt('PHANERIS_PROMPT');
    const loader = await createPhanerisResourceLoader({ cwd: dir, agentDir: join(dir, '.pi-agent') });
    expect(loader.getSystemPrompt()).toBe('PHANERIS_PROMPT');
  });

  it('falls back to the base prompt when no Phaneris prompt is set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-loader-'));
    setPhanerisSystemPrompt('');
    const loader = await createPhanerisResourceLoader({ cwd: dir, agentDir: join(dir, '.pi-agent') });
    expect(loader.getSystemPrompt()).toBeUndefined();
  });

  it('honors an injected getPrompt instead of the module-level prompt (ephemeral isolation)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-loader-'));
    setPhanerisSystemPrompt('MODULE_PROMPT');
    const loader = await createPhanerisResourceLoader({
      cwd: dir,
      agentDir: join(dir, '.pi-agent'),
      getPrompt: () => 'EPHEMERAL',
    });
    expect(loader.getSystemPrompt()).toBe('EPHEMERAL');
  });
});
