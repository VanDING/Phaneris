import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BACKGROUND_HEX,
  BUILTIN_THEMES,
  DEFAULT_THEME_FILE,
  resolveTheme,
  resolveThemeMode,
  themeToCSS,
  type ThemeOverrides,
} from '../theme.ts';
import { validateThemeContent, validateThemeOverrideContent } from '../validators.ts';

describe('themeToCSS', () => {
  test('emits semantic and visual tokens from a theme file', () => {
    const theme: ThemeOverrides = {
      background: '#ffffff',
      foreground: '#111111',
      secondary: '#eeeeee',
      border: '#cccccc',
      radius: '12px',
      borderWidth: '2px',
      borderStyle: 'dashed',
      fontSans: 'Inter, sans-serif',
      fontSize: '16px',
      letterSpacing: '0.01em',
      lineHeight: 1.6,
      iconStrokeWidth: 1.5,
      iconStrokeLinecap: 'square',
      density: 'compact',
    };

    const css = themeToCSS(theme);

    expect(css).toContain('--secondary: #eeeeee;');
    expect(css).toContain('--border: #cccccc;');
    expect(css).toContain('--theme-radius: 12px;');
    expect(css).toContain('--theme-panel-radius: 12px;');
    expect(css).toContain('--theme-border-width: 2px;');
    expect(css).toContain('--theme-border-style: dashed;');
    expect(css).toContain('--font-sans: Inter, sans-serif;');
    expect(css).toContain('--font-size-base: 16px;');
    expect(css).toContain('--tracking-normal: 0.01em;');
    expect(css).toContain('--line-height-base: 1.6;');
    expect(css).toContain('--icon-stroke-width: 1.5;');
    expect(css).toContain('--icon-stroke-linecap: square;');
    expect(css).toContain('--theme-density: compact;');
    expect(css).toContain('--theme-density-scale: 0.875;');
    expect(css).toContain('--theme-row-padding-y: 0.625rem;');
    expect(css).toContain('--theme-menu-item-padding-y: 0.25rem;');
    expect(css).not.toContain('--spacing:');
  });

  test('expands each high-level depth preset', () => {
    for (const depth of ['flat', 'elevated', 'neon', 'glass', 'raised'] as const) {
      const css = themeToCSS({ depth, shadowColor: '#6633ff', shadowStrength: 0.2 });
      expect(css).toContain(`--theme-depth: ${depth};`);
      expect(css).toContain('--theme-shadow-color: #6633ff;');
      expect(css).toContain('--shadow-minimal:');
      expect(css).toContain('--shadow-middle:');
      expect(css).toContain('--shadow-strong:');
      expect(css).toContain('--shadow-modal-small:');
    }
  });

  test('glass depth exposes blur while other depths disable it', () => {
    expect(themeToCSS({ depth: 'glass', glassBlur: '28px' })).toContain(
      '--theme-backdrop-blur: 28px;'
    );
    expect(themeToCSS({ depth: 'flat', glassBlur: '28px' })).toContain(
      '--theme-backdrop-blur: 0px;'
    );
  });

  test('raised depth combines a hard border ring with zero-blur offset shadows', () => {
    const css = themeToCSS({ depth: 'raised', borderWidth: '2px', shadowColor: '#111111' });
    expect(css).toContain(
      '--shadow-minimal: 0 0 0 var(--theme-border-width) var(--border), 3px 3px 0 color-mix(in srgb, var(--theme-shadow-color) 10%, transparent);'
    );
  });

  test('keeps status colors in their original CSS syntax without parallel RGB channels', () => {
    const css = themeToCSS({
      info: 'oklch(0.8 0.15 90)',
      success: 'hsl(150 80% 40%)',
      destructive: 'rebeccapurple',
    });

    expect(css).toContain('--info: oklch(0.8 0.15 90);');
    expect(css).toContain('--success: hsl(150 80% 40%);');
    expect(css).toContain('--destructive: rebeccapurple;');
    expect(css).not.toContain('-rgb:');
  });

  test('leaves omitted surfaces and material tokens on the static Default baseline', () => {
    const css = themeToCSS({ accent: '#3366ff' });

    expect(css).toContain('--accent: #3366ff;');
    expect(css).not.toContain('--paper:');
    expect(css).not.toContain('--input:');
    expect(css).not.toContain('--theme-depth:');
    expect(css).not.toContain('--shadow-minimal:');
  });

  test('dark mode overrides visual tokens without losing light defaults', () => {
    const theme: ThemeOverrides = {
      background: '#ffffff',
      radius: '8px',
      depth: 'flat',
      dark: {
        background: '#111111',
        radius: '2px',
        depth: 'neon',
        shadowColor: '#00ffff',
      },
    };

    const darkCSS = themeToCSS(theme, true);
    expect(darkCSS).toContain('--background: #111111;');
    expect(darkCSS).toContain('--theme-radius: 2px;');
    expect(darkCSS).toContain('--theme-depth: neon;');
    expect(darkCSS).toContain('--theme-shadow-color: #00ffff;');
  });
});

describe('theme resolution', () => {
  test('deeply overlays a user theme onto the canonical default', () => {
    const resolved = resolveTheme({
      accent: '#123456',
      dark: { accent: '#abcdef' },
    });

    expect(resolved.background).toBe(DEFAULT_THEME_FILE.background);
    expect(resolved.accent).toBe('#123456');
    expect(resolved.dark?.background).toBe(DEFAULT_THEME_FILE.dark?.background);
    expect(resolved.dark?.accent).toBe('#abcdef');
  });

  test('normalizes both light-only and dark-only themes', () => {
    expect(resolveThemeMode({ supportedModes: ['light'] }, 'dark')).toBe('light');
    expect(resolveThemeMode({ supportedModes: ['dark'] }, 'light')).toBe('dark');
    expect(resolveThemeMode({ supportedModes: ['light', 'dark'] }, 'dark')).toBe('dark');
    expect(resolveThemeMode({ mode: 'scenic' }, 'light')).toBe('dark');
  });

  test('keeps the bundled default resource synchronized with the canonical snapshot', () => {
    const resourcePath = resolve(
      import.meta.dir,
      '../../../../../apps/electron/resources/themes/default.json'
    );
    const resourceTheme = JSON.parse(readFileSync(resourcePath, 'utf-8'));
    expect(resourceTheme).toEqual(DEFAULT_THEME_FILE);
  });

  test('bundles exactly the four canonical, valid themes', () => {
    expect(Object.keys(BUILTIN_THEMES)).toEqual(['default', 'geek', 'cyberpunk-2077', 'ink']);
    for (const [id, theme] of Object.entries(BUILTIN_THEMES)) {
      const path = resolve(import.meta.dir, `../../../../../apps/electron/resources/themes/${id}.json`);
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(theme);
      expect(validateThemeContent(JSON.stringify(theme)).valid).toBe(true);
    }
    expect(DEFAULT_THEME_FILE.name).toBe('Default');
    expect(DEFAULT_THEME_FILE.accent).toBe('oklch(0.488 0.275 280.3)');
    expect(DEFAULT_THEME_FILE.dark?.accent).toBe('oklch(0.626 0.221 291.7)');
  });

  test('keeps Electron startup backgrounds aligned with the Default CSS colors', () => {
    // Widen the theme-derived strings so this toEqual overload does not demand
    // the literal types produced by BACKGROUND_HEX's as-const assertion.
    const actual: Record<'light' | 'dark', string> = BACKGROUND_HEX;
    // BrowserWindow accepts hex; keep startup surfaces on the applied Default palette.
    expect(actual).toEqual({ light: '#FFFFFF', dark: '#17191E' });
  });

  test('keeps static CSS palettes, typography and material tokens synchronized with Default', () => {
    const electronCSS = readFileSync(resolve(
      import.meta.dir,
      '../../../../../apps/electron/src/renderer/index.css'
    ), 'utf-8');
    const sharedUICSS = readFileSync(resolve(
      import.meta.dir,
      '../../../../ui/src/styles/index.css'
    ), 'utf-8');
    const typographyCSS = readFileSync(resolve(
      import.meta.dir,
      '../../../../ui/src/styles/typography.css'
    ), 'utf-8');

    const declarations = (css: string) => new Map(
      [...css.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(match => [match[1]!, match[2]!.trim()])
    );
    const rootBlock = (css: string) => {
      const match = css.match(/:root \{([\s\S]*?)\n\}/);
      if (!match) throw new Error('No :root block found');
      return match[1]!;
    };

    // Font stacks are owned by typography.css, which both app stylesheets import;
    // every other token is declared in each app's own `:root`. Asserting the font
    // tokens against those two files would demand a second static source of truth
    // (and did, until this assertion was corrected).
    const fontTokens = new Set(['--font-sans', '--font-serif', '--font-mono']);
    for (const css of [electronCSS, sharedUICSS]) {
      const light = declarations(rootBlock(css));
      const dark = new Map([...light, ...declarations(css.match(/\.dark \{([\s\S]*?)\n\}/)![1]!)]);
      for (const token of fontTokens) {
        expect(light.has(token)).toBe(false);
      }
      for (const isDark of [false, true]) {
        const actual = isDark ? dark : light;
        for (const [key, value] of declarations(themeToCSS(DEFAULT_THEME_FILE, isDark))) {
          if (fontTokens.has(key)) continue;
          expect(actual.get(key)).toBe(value);
        }
      }
    }

    // `--font-cjk` keeps Han on the bundled face when a stack splices it in, so the
    // canonical theme expands it rather than repeating the family list. Compare the
    // expanded forms: formatting may differ, the resolved family order may not.
    const typography = declarations(rootBlock(typographyCSS));
    const expandCJK = (value: string) => {
      const cjk = typography.get('--font-cjk');
      if (cjk === undefined) throw new Error('typography.css must declare --font-cjk');
      return value.replaceAll('var(--font-cjk)', cjk).replace(/\s+/g, ' ').trim();
    };
    for (const token of fontTokens) {
      const declared = typography.get(token);
      expect(declared).toBeDefined();
      expect(expandCJK(declared!)).toBe(expandCJK(themeToCSS(DEFAULT_THEME_FILE, false).match(
        new RegExp(`${token}:\\s*([^;]+);`)
      )![1]!));
    }

    // The two `data-font` overrides deliberately outrank the theme token, so each
    // declaring file must keep them after its `:root` block. `inter` splices in the
    // bundled Han face; `system` is native end to end on purpose (Han falls to the
    // OS face), so it must NOT — pinning both directions keeps either from being
    // "fixed" into the other.
    const blockFor = (css: string, selector: string) => {
      const start = css.indexOf(`${selector} {`);
      if (start === -1) return null;
      return declarations(css.slice(start, css.indexOf('\n}', start)));
    };
    for (const font of ['inter', 'system']) {
      const selector = `html[data-font="${font}"]`;
      const owners = [electronCSS, sharedUICSS].filter(css => css.includes(`${selector} {`));
      expect(owners.length).toBeGreaterThan(0);
      for (const owner of owners) {
        const block = blockFor(owner, selector)!;
        expect(block.has('--font-sans')).toBe(true);
        expect(block.has('--font-default')).toBe(true);
        // Later in the file than `:root`, so it still wins at equal specificity.
        expect(owner.indexOf(`${selector} {`)).toBeGreaterThan(owner.indexOf(':root {'));
        const usesBundledHan = block.get('--font-sans')!.includes('var(--font-cjk)');
        expect(usesBundledHan).toBe(font === 'inter');
      }
    }

    expect(DEFAULT_THEME_FILE.navigator).toBeUndefined();
    expect(DEFAULT_THEME_FILE.dark?.navigator).toBeUndefined();
  });
});

describe('theme validation', () => {
  test('accepts the expanded preset schema', () => {
    const result = validateThemeContent(JSON.stringify({
      name: 'Engine fixture',
      background: '#fff',
      foreground: '#111',
      depth: 'raised',
      radius: '0px',
      borderWidth: '2px',
      borderStyle: 'solid',
      density: 'cozy',
      dark: {
        background: '#111',
        foreground: '#fff',
        depth: 'neon',
      },
    }));

    expect(result.valid).toBe(true);
  });

  test('rejects unsupported values and CSS declaration injection', () => {
    expect(validateThemeOverrideContent(JSON.stringify({ depth: 'animated' })).valid).toBe(false);
    expect(validateThemeOverrideContent(JSON.stringify({ radius: '8px; color: red' })).valid).toBe(false);
    expect(validateThemeOverrideContent(JSON.stringify({ shadowStrength: 2 })).valid).toBe(false);
  });

  test('rejects unknown preset fields and ambiguous supported modes', () => {
    const base = { name: 'Strict fixture', accent: '#6633ff' };
    expect(validateThemeContent(JSON.stringify({ ...base, typoToken: '#fff' })).valid).toBe(false);
    expect(validateThemeContent(JSON.stringify({ ...base, supportedModes: [] })).valid).toBe(false);
    expect(validateThemeContent(JSON.stringify({ ...base, supportedModes: ['dark', 'dark'] })).valid).toBe(false);
  });
});
