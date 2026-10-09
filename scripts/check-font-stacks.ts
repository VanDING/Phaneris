#!/usr/bin/env bun
/**
 * check-font-stacks.ts — the default font stack necessarily exists twice: once as
 * CSS custom properties in `packages/ui/src/styles/typography.css` (what the
 * browser paints) and once in `packages/shared/src/config/theme.ts`
 * (`DEFAULT_THEME`, which the theme engine reports as the resolved theme's
 * typography and which every font-less theme inherits).
 *
 * Those two copies drifted before, and so did four hand-copied stacks across the
 * renderer stylesheets — the documentation ended up recommending a third order.
 * Nothing caught it because a wrong font stack is not a type error: it just
 * renders, quietly, in the wrong face.
 *
 * This gate enforces:
 *   1. `typography.css` and `DEFAULT_THEME` declare identical stacks.
 *   2. The bundled CJK family is present in the sans stack, and the package that
 *      provides it is actually installed with a variable weight axis — the whole
 *      point of bundling it is that `font-weight: 500` stops being a no-op on Han.
 *   3. No other stylesheet re-declares the stacks. `html[data-font="..."]`
 *      overrides are allowed, but an override that drops `var(--font-cjk)` would
 *      send Han back to the system-default lottery, so it must keep it (the
 *      deliberately-native `system` variant is the one documented exemption).
 *
 * Usage:
 *   bun run check:fonts
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { globSync } from 'node:fs';
import { DEFAULT_THEME } from '../packages/shared/src/config/theme.ts';

const ROOT = join(import.meta.dir, '..');
const TYPOGRAPHY = join(ROOT, 'packages', 'ui', 'src', 'styles', 'typography.css');

/**
 * Every face the UI paints with. The app must not fetch fonts at runtime, so
 * each of these has to be installed and variable — a static-weight bundle would
 * silently reintroduce the `font-weight: 500` snapping the CJK face was added to
 * fix.
 */
interface BundledFace {
  family: string;
  pkg: string;
  entry: string;
  weightRange: RegExp;
  /** The custom property whose stack must name this family. */
  inStack: string;
}

const BUNDLED: BundledFace[] = [
  {
    family: 'Noto Sans SC Variable',
    pkg: '@fontsource-variable/noto-sans-sc',
    entry: 'wght.css',
    weightRange: /font-weight:\s*100 900/,
    inStack: '--font-cjk',
  },
  {
    family: 'Inter Variable',
    pkg: '@fontsource-variable/inter',
    // The `opsz` entry carries wght *and* the optical-size axis, which is what
    // makes `font-optical-sizing: auto` meaningful for this face.
    entry: 'opsz.css',
    weightRange: /font-weight:\s*100 900/,
    inStack: '--font-sans',
  },
  {
    family: 'JetBrains Mono Variable',
    pkg: '@fontsource-variable/jetbrains-mono',
    entry: 'wght.css',
    weightRange: /font-weight:\s*100 800/,
    inStack: '--font-mono',
  },
];

const failures: string[] = [];
const fail = (message: string) => failures.push(message);

/** Collapse whitespace and normalise quote style so formatting never fails the gate. */
function normalize(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/'/g, '"')
    .trim();
}

/** First declaration of a custom property in a stylesheet. */
function readCustomProperty(css: string, name: string): string | undefined {
  const match = css.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  return match?.[1];
}

const css = readFileSync(TYPOGRAPHY, 'utf8');

const cjk = readCustomProperty(css, '--font-cjk');
if (!cjk) {
  fail(`${relative(ROOT, TYPOGRAPHY)} declares no --font-cjk; the data-font overrides depend on it.`);
}

/** Resolve `var(--font-cjk)` so the CSS and TS stacks are comparable. */
function expand(value: string): string {
  return normalize(value).replace(/var\(--font-cjk\)/g, cjk ? normalize(cjk) : 'var(--font-cjk)');
}

const PAIRS: Array<[cssVar: string, themeKey: 'fontSans' | 'fontSerif' | 'fontMono']> = [
  ['--font-sans', 'fontSans'],
  ['--font-serif', 'fontSerif'],
  ['--font-mono', 'fontMono'],
];

for (const [cssVar, themeKey] of PAIRS) {
  const fromCss = readCustomProperty(css, cssVar);
  const fromTheme = DEFAULT_THEME[themeKey];
  if (!fromCss) {
    fail(`${relative(ROOT, TYPOGRAPHY)} declares no ${cssVar}.`);
    continue;
  }
  if (!fromTheme) {
    fail(`DEFAULT_THEME.${themeKey} is empty.`);
    continue;
  }
  if (expand(fromCss) !== normalize(fromTheme)) {
    fail(
      `${cssVar} differs between typography.css and DEFAULT_THEME.${themeKey}.\n` +
        `    typography.css : ${expand(fromCss)}\n` +
        `    DEFAULT_THEME  : ${normalize(fromTheme)}\n` +
        '    The theme engine uses the DEFAULT_THEME value for any theme that does not\n' +
        '    author its own stack, so these must match exactly.',
    );
  }
}

// 2. The bundled faces: listed in the right stack, installed, and variable.
const cjkFace = BUNDLED[0]!;
if (cjk && !normalize(cjk).split(',').some((family) => family.trim().replace(/"/g, '') === cjkFace.family)) {
  fail(`--font-cjk does not list the bundled family "${cjkFace.family}".`);
}

const sans = readCustomProperty(css, '--font-sans');
if (sans && !sans.includes('var(--font-cjk)')) {
  fail('--font-sans does not reference var(--font-cjk), so Han would fall through to the generic default.');
}

for (const face of BUNDLED) {
  const stack = readCustomProperty(css, face.inStack);
  if (stack && !stack.includes(`"${face.family}"`)) {
    fail(`${face.inStack} does not list the bundled family "${face.family}" (from ${face.pkg}).`);
  }

  const pkgCss = join(ROOT, 'node_modules', face.pkg, face.entry);
  if (!existsSync(pkgCss)) {
    fail(
      `${face.pkg} is not installed (missing ${relative(ROOT, pkgCss)}).\n` +
        `    Without it "${face.family}" silently falls back to a system font.`,
    );
    continue;
  }
  const bundled = readFileSync(pkgCss, 'utf8');
  if (!bundled.includes(`font-family: '${face.family}'`) && !bundled.includes(`font-family:"${face.family}"`)) {
    fail(`${face.pkg}/${face.entry} does not declare family "${face.family}".`);
  }
  if (!face.weightRange.test(bundled)) {
    fail(`${face.pkg}/${face.entry} does not declare a variable weight axis (${face.weightRange}).`);
  }
}

// 2b. No font CDN in shipped sources. Every renderer CSP already refuses remote
//     fonts, but a <link> added back would only fail at runtime, on a machine
//     nobody is watching — exactly how the Google Fonts dependency survived here.
const CDN_HOSTS = /fonts\.googleapis\.com|fonts\.gstatic\.com/;
/** Workspace Pages are user-authored HTML and opt into Google Fonts on purpose. */
const CDN_EXEMPT = [join('apps', 'electron', 'src', 'shared', 'page-document.ts')];

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')    // /* block */   (CSS + TS)
    .replace(/<!--[\s\S]*?-->/g, '')      // <!-- html -->
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');  // // line
}

/** Build output and installed packages never count as source. */
function isSource(rel: string): boolean {
  const parts = rel.split(/[\\/]/);
  return !parts.some((part) => part === 'node_modules' || part === 'dist' || part === 'release' || part === 'out');
}

const shippedSources = [
  ...globSync('packages/**/*.{css,ts,tsx,html}', { cwd: ROOT }),
  ...globSync('apps/**/*.{css,ts,tsx,html}', { cwd: ROOT }),
].filter(isSource);

for (const rel of shippedSources) {
  if (CDN_EXEMPT.some((exempt) => rel.endsWith(exempt))) continue;
  const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
  const hit = code.match(CDN_HOSTS);
  if (hit) {
    const line = code.slice(0, code.indexOf(hit[0])).split('\n').length;
    fail(
      `${rel}:${line} still references ${hit[0]}.\n` +
        '    Fonts ship in the bundle — see packages/ui/src/styles/typography.css.\n' +
        '    (Workspace Pages are the only sanctioned exception; they set their own CSP.)',
    );
  }
}

// 3. No stray re-declarations outside typography.css.
const CANONICAL = new Set(['--font-sans', '--font-serif', '--font-mono']);
const stylesheets = [
  ...globSync('packages/**/*.css', { cwd: ROOT }),
  ...globSync('apps/**/*.css', { cwd: ROOT }),
].filter(isSource);

for (const rel of stylesheets) {
  const abs = join(ROOT, rel);
  if (abs === TYPOGRAPHY) continue;
  const source = readFileSync(abs, 'utf8');

  for (const cssVar of CANONICAL) {
    for (const match of source.matchAll(new RegExp(`(${cssVar}\\s*:\\s*)([^;]+);`, 'g'))) {
      const value = normalize(match[2] ?? '');
      // The Tailwind `@theme inline` mapping is a self-reference, not a stack.
      if (value === `var(${cssVar})`) continue;

      const index = match.index ?? 0;
      const line = source.slice(0, index).split('\n').length;
      const selector = source.slice(0, index).match(/html\[data-font="[a-z]+"\]\s*\{[^}]*$/)?.[0];

      if (cssVar !== '--font-sans') {
        fail(
          `${rel}:${line} re-declares ${cssVar}. Only typography.css owns the stacks;\n` +
            '    a copy here will drift from DEFAULT_THEME without anything noticing.',
        );
        continue;
      }

      if (!selector) {
        fail(
          `${rel}:${line} re-declares --font-sans outside an html[data-font="..."] override.\n` +
            '    Move it to packages/ui/src/styles/typography.css so every surface shares one stack.',
        );
        continue;
      }

      // The `system` preference is documented as native end to end; everything
      // else must keep Han on the bundled face.
      if (!selector.includes('data-font="system"') && !value.includes('var(--font-cjk)')) {
        fail(
          `${rel}:${line} overrides --font-sans without var(--font-cjk); Han would fall back to\n` +
            '    whatever CJK face the OS happens to default to.',
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Font stack check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  'Font stacks OK: typography.css and DEFAULT_THEME agree; bundled faces installed and variable; no font CDN in shipped sources.',
);
