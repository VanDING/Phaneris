import babelParser from '@babel/eslint-parser'
import { commonRules } from './scripts/eslint-common.mjs'
import { visualConfig } from './scripts/eslint-visual.mjs'

export default [
  visualConfig(['apps/webui/src/**/*.{ts,tsx}', 'apps/viewer/src/**/*.{ts,tsx}']),
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.cache/**', '**/identity.generated.*'] },
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    languageOptions: {
      parser: babelParser,
      parserOptions: { requireConfigFile: false, babelOptions: { presets: ['@babel/preset-typescript'] } },
    },
    rules: commonRules,
  },
  {
    files: ['**/*.tsx'],
    languageOptions: {
      parser: babelParser,
      parserOptions: { requireConfigFile: false, babelOptions: { presets: ['@babel/preset-typescript', '@babel/preset-react'] } },
    },
  },
]
