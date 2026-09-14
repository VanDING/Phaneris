import { mock, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('never replaces an existing protected key when the keychain is unavailable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'craft-os-key-'));
  const file = join(dir, 'credentials.key');
  let available = false;
  // The provider takes its path from the central resolver (`config/paths.ts`),
  // so point that module at the temp dir instead of mocking `node:os`.
  mock.module('@phaneris/shared/config/paths', () => ({
    CONFIG_DIR: dir,
    CREDENTIALS_KEY_FILE: file,
  }));
  mock.module('electron', () => ({ safeStorage: {
    isEncryptionAvailable: () => available,
    decryptString: () => { throw new Error('keychain locked'); },
    encryptString: () => { throw new Error('must not create replacement'); },
  } }));
  mock.module('./logger', () => ({ mainLog: { warn() {}, info() {} } }));
  mock.module('@phaneris/shared/credentials', () => ({ setCredentialKeyProvider() {} }));
  try {
    writeFileSync(file, 'original-key');
    const { installElectronCredentialKeyProvider } = await import('./credential-key-provider');
    expect(() => installElectronCredentialKeyProvider()).toThrow('unavailable');
    available = true;
    expect(() => installElectronCredentialKeyProvider()).toThrow('keychain locked');
    expect(readFileSync(file, 'utf8')).toBe('original-key');
  } finally { mock.restore(); rmSync(dir, { recursive: true, force: true }); }
});
