import { commonRules } from '../../scripts/eslint-common.mjs'
import babelParser from '@babel/eslint-parser'

export default [
  {
    ignores: ['node_modules/**', 'dist/**', '**/*.md'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: commonRules,
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        requireConfigFile: false,
        babelOptions: {
          presets: ['@babel/preset-typescript'],
        },
      },
    },
  },
]
