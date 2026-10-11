import babelParser from '@babel/eslint-parser'
import { commonRules } from './scripts/eslint-common.mjs'

export default [
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
