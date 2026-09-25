/**
 * ESLint Configuration for Electron App
 *
 * Uses flat config format (ESLint 9+).
 * Includes custom navigation rule to enforce navigate() usage.
 * Parser: @babel/eslint-parser (TS 7 compatible)
 */

import babelParser from '@babel/eslint-parser'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y'
import noDirectNavigationState from './eslint-rules/no-direct-navigation-state.cjs'
import noLocalStorage from './eslint-rules/no-localstorage.cjs'
import noDirectPlatformCheck from './eslint-rules/no-direct-platform-check.cjs'
import noHardcodedPathSeparator from './eslint-rules/no-hardcoded-path-separator.cjs'
import noDirectFileOpen from './eslint-rules/no-direct-file-open.cjs'
import noInlineSourceAuthCheck from './eslint-rules/no-inline-source-auth-check.cjs'
import noHardcodedZIndex from './eslint-rules/no-hardcoded-z-index.cjs'
import noNonstandardShadows from './eslint-rules/no-nonstandard-shadows.cjs'
import noTransitionAll from '../../scripts/eslint-rules/no-transition-all.cjs'

export default [
  // Ignore patterns
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'release/**',
      '*.cjs',
      'eslint-rules/**',
    ],
  },

  // TypeScript/React files
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
        requireConfigFile: false,
        babelOptions: {
          presets: ['@babel/preset-typescript', '@babel/preset-react'],
        },
      },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      // Custom plugin for Phaneris rules
      'craft-agent': {
        rules: {
          'no-direct-navigation-state': noDirectNavigationState,
          'no-localstorage': noLocalStorage,
        },
      },
      // Custom plugin for platform detection rules
      'craft-platform': {
        rules: {
          'no-direct-platform-check': noDirectPlatformCheck,
        },
      },
      // Custom plugin for cross-platform path rules
      'craft-paths': {
        rules: {
          'no-hardcoded-path-separator': noHardcodedPathSeparator,
        },
      },
      // Custom plugin for link interceptor enforcement
      'craft-links': {
        rules: {
          'no-direct-file-open': noDirectFileOpen,
        },
      },
      // Custom plugin for source auth checks (shared with packages/shared)
      'craft-sources': {
        rules: {
          'no-inline-source-auth-check': noInlineSourceAuthCheck,
        },
      },
      // Custom style rules
      'craft-styles': {
        rules: {
          'no-hardcoded-z-index': noHardcodedZIndex,
          'no-nonstandard-shadows': noNonstandardShadows,
          'no-transition-all': noTransitionAll,
        },
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      // React Hooks rules
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Custom Phaneris rules
      'craft-agent/no-direct-navigation-state': 'error',
      'craft-agent/no-localstorage': 'warn',

      // Custom platform detection rule
      'craft-platform/no-direct-platform-check': 'error',

      // Custom cross-platform path rule
      'craft-paths/no-hardcoded-path-separator': 'warn',

      // Custom link interceptor rule — prevents bypassing in-app file preview
      'craft-links/no-direct-file-open': 'error',

      // Custom source auth check rule — use isSourceUsable() instead of inline checks
      'craft-sources/no-inline-source-auth-check': 'error',

      // Custom style rule — use z-index token scale instead of hardcoded literals
      'craft-styles/no-hardcoded-z-index': 'error',

      // Custom style rule — enforce approved shadow classes/tokens only
      'craft-styles/no-nonstandard-shadows': ['error', {
        allowedClasses: [
          'shadow-none',
          'shadow-xs',
          'shadow-minimal',
          'shadow-tinted',
          'shadow-thin',
          'shadow-middle',
          'shadow-strong',
          'shadow-panel-focused',
          'shadow-modal-small',
          'shadow-bottom-border',
          'shadow-bottom-border-thin',
        ],
        allowInlineNone: true,
      }],

      // Broad transitions are fragile and may accidentally animate layout/paint.
      'craft-styles/no-transition-all': 'error',

      // Enforce centralized action registry for keyboard shortcuts
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: 'react-hotkeys-hook',
            message: 'Use useAction from @/actions instead. See actions/index.ts'
          }
        ],
      }],
    },
  },

  /*
   * Accessibility, scoped to the surfaces this migration rebuilt.
   *
   * The calendar, the timeline and the board are now keyboard reachable by
   * construction (the old chips were unfocusable divs), but "reachable" is not
   * "correct": a clickable div needs a role, a control needs a name. `recommended`
   * is enabled where the new markup lives rather than repo-wide, so the rule set
   * stays actionable instead of drowning in pre-existing findings elsewhere.
   */
  {
    files: [
      'src/renderer/components/app-shell/kanban/**/*.{ts,tsx}',
      'src/renderer/components/projects/{ProjectManagementSurface,TaskEditorOverlay}.tsx',
    ],
    plugins: { 'jsx-a11y': jsxA11yPlugin },
    rules: { ...jsxA11yPlugin.flatConfigs.recommended.rules },
  },

  // Temporary exceptions for unresolved shadow migrations.
  {
    files: [
      'src/renderer/components/ui/sortable-list.tsx',
      'src/main/browser-pane-manager.ts',
      'src/shared/browser-live-fx.ts',
      'src/renderer/components/KeyboardShortcutsDialog.tsx',
      'src/renderer/playground/**/*.{ts,tsx}',
    ],
    rules: {
      'craft-styles/no-nonstandard-shadows': 'off',
    },
  },

  // Playground examples may intentionally demonstrate arbitrary transitions.
  {
    files: ['src/renderer/playground/**/*.{ts,tsx}'],
    rules: {
      'craft-styles/no-transition-all': 'off',
    },
  },

  // Enforce backend abstraction boundary in Electron main process.
  {
    files: ['src/main/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: '@phaneris/shared/codex',
            message: 'Use provider-agnostic APIs from @phaneris/shared/agent/backend instead.',
          },
          {
            name: '@phaneris/shared/agent/claude-agent',
            message: 'Provider backends must stay behind @phaneris/shared/agent/backend.',
          },
          {
            name: '@phaneris/shared/agent/pi-agent',
            message: 'Provider backends must stay behind @phaneris/shared/agent/backend.',
          },
        ],
      }],
    },
  },

  // Keep main model fetchers provider-agnostic (delegate to shared backend APIs only).
  {
    files: ['src/main/model-fetchers/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message: 'Do not call provider APIs directly in Electron model fetchers. Delegate to fetchBackendModels() from @phaneris/shared/agent/backend.',
        },
        {
          selector: "ImportDeclaration[source.value='@earendil-works/pi-ai']",
          message: 'Provider SDK usage must stay in backend drivers under packages/shared/src/agent/backend/internal/drivers.',
        },
        {
          selector: "ImportDeclaration[source.value='@earendil-works/pi-coding-agent']",
          message: 'Provider SDK usage must stay in backend drivers under packages/shared/src/agent/backend/internal/drivers.',
        },
      ],
    },
  },
]
