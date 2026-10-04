import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { reactPdfAlias } from '../../scripts/build/react-pdf-alias.ts'

export default defineConfig({
  plugins: [
    react(),
    babel({
      plugins: [
        // Jotai 3 moved these plugins out of the core package into `jotai-babel`.
        'jotai-babel/plugin-debug-label',
        ['jotai-babel/plugin-react-refresh', { customAtomNames: ['atomFamily'] }],
      ],
    }),
    tailwindcss(),
  ],
  root: resolve(import.meta.dirname, 'src'),
  base: './',
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'src/index.html'),
        login: resolve(import.meta.dirname, 'src/login.html'),
      },
      // Suppress warnings for Node.js externalized modules — these are
      // referenced by shared code but only used in server/Electron codepaths.
      onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
        warn(warning)
      },
    },
  },
  resolve: {
    alias: {
      ...reactPdfAlias(import.meta.url),
      // Reuse the Electron renderer's components, hooks, pages, etc.
      '@': resolve(import.meta.dirname, '../electron/src/renderer'),
      // Web-specific overrides
      '@webui': resolve(import.meta.dirname, 'src'),
      // Config alias (same as Electron)
      '@config': resolve(import.meta.dirname, '../../packages/shared/src/config'),
      // Force single React copy from root node_modules
      'react': resolve(import.meta.dirname, '../../node_modules/react'),
      'react-dom': resolve(import.meta.dirname, '../../node_modules/react-dom'),
      // rehype-katex 7 declares katex ^0.16 but only calls the stable
      // renderToString API; resolve both copies to the single current katex to
      // avoid shipping two ~240 KB copies in the initial renderer graph.
      'katex': resolve(import.meta.dirname, '../../node_modules/katex'),
      // Electron-specific modules → empty shims for browser builds
      '@sentry/electron/renderer': resolve(import.meta.dirname, 'src/shims/sentry-electron.ts'),
      '@sentry/electron': resolve(import.meta.dirname, 'src/shims/sentry-electron.ts'),
      // Node.js 'ws' library → browser uses native WebSocket
      'ws': resolve(import.meta.dirname, 'src/shims/ws.ts'),
      // Match subpaths before their parent aliases.
      'electron-log/main': resolve(import.meta.dirname, 'src/shims/electron-log.ts'),
      'electron-log/renderer': resolve(import.meta.dirname, 'src/shims/electron-log.ts'),
      'electron-log': resolve(import.meta.dirname, 'src/shims/electron-log.ts'),
      'fs/promises': resolve(import.meta.dirname, 'src/shims/fs-promises.ts'),
      'node:fs/promises': resolve(import.meta.dirname, 'src/shims/fs-promises.ts'),
      'stream/web': resolve(import.meta.dirname, 'src/shims/stream-web.ts'),
      'node:stream/web': resolve(import.meta.dirname, 'src/shims/stream-web.ts'),
      // Node.js builtins → browser-safe shims (shared code imports these
      // but the codepaths aren't reached in browser — web API adapter intercepts)
      ...Object.fromEntries([
        'fs', 'node:fs', 'path', 'node:path', 'child_process', 'node:child_process',
        'os', 'node:os', 'node:crypto', 'node:util', 'node:process', 'node:buffer',
        'node:https', 'node:http', 'node:net', 'node:url', 'node:events',
        'crypto', 'https', 'http', 'net', 'events', 'util', 'buffer', 'stream',
        'node:stream', 'tls', 'node:tls', 'url', 'zlib', 'node:zlib',
        'string_decoder', 'node:string_decoder', 'assert', 'node:assert',
      ].map(m => [m, resolve(import.meta.dirname, 'src/shims/node-builtins.ts')])),
      // 'open' npm package (Node.js shell utility) — no-op in browser
      'open': resolve(import.meta.dirname, 'src/shims/open.ts'),
    },
    dedupe: ['react', 'react-dom', 'katex'],
  },
  define: {
    // Flag to detect web UI context in shared code
    'import.meta.env.IS_WEBUI': 'true',
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'jotai'],
    exclude: ['@phaneris/ui'],
  },
  server: {
    port: 5175,
    open: false,
    host: true,
    // Proxy API + WS to the headless server so the dev bundle on :5175 works
    // end-to-end with HMR. Target port follows PHANERIS_RPC_PORT (default 9100).
    // Auto-detects TLS: if the server has PHANERIS_RPC_TLS_KEY/CERT set, we proxy
    // over https/wss with secure:false to accept the self-signed dev cert.
    proxy: (() => {
      const port = process.env.PHANERIS_RPC_PORT ?? '9100'
      const useTls = Boolean(process.env.PHANERIS_RPC_TLS_KEY || process.env.PHANERIS_RPC_TLS_CERT)
      const httpProto = useTls ? 'https' : 'http'
      const wsProto = useTls ? 'wss' : 'ws'
      const httpTarget = `${httpProto}://127.0.0.1:${port}`
      const wsTarget = `${wsProto}://127.0.0.1:${port}`
      return {
        '/api': { target: httpTarget, changeOrigin: true, secure: false },
        '/login': { target: httpTarget, changeOrigin: true, secure: false },
        '/ws': { target: wsTarget, ws: true, secure: false },
      }
    })(),
  },
})
