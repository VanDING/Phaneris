// Generates dist/index.js — a thin launcher for the real SDK bundle.
//
// Pi 0.85.0's main.js chain (re-exported from the package root) carries
// top-level entry guards (experimental/server.js etc.) that throw when the
// bundler output is executed directly (argv[1] === import.meta.url). Splitting
// the bundle into bundle.js + this launcher keeps the guard's moduleUrl
// distinct from the executed entry, so the SDK's own coordinator/server entry
// checks never fire while our subprocess runs.
await Bun.write(new URL('../dist/index.js', import.meta.url), 'import "./bundle.js";\n');

// Codemode starts its own worker. Build it as a second entry and ship the VM
// beside the server so packaged runs never depend on the checkout's node_modules.
const { dirname, join } = await import('node:path');
const { mkdirSync, copyFileSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const sdkDist = dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent')));
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const worker = await Bun.build({ entrypoints: [join(sdkDist, 'extensions/codemode/worker.js')], target: 'bun', format: 'esm', minify: true });
if (!worker.success) throw new Error(`Codemode worker build failed: ${worker.logs.join('\n')}`);
await Bun.write(join(dist, 'worker.js'), worker.outputs[0]!);
const wasmDir = join(dist, 'node_modules/quickjs-wasi');
mkdirSync(wasmDir, { recursive: true });
copyFileSync(fileURLToPath(import.meta.resolve('quickjs-wasi/quickjs.wasm')), join(wasmDir, 'quickjs.wasm'));
await Bun.write(join(wasmDir, 'package.json'), JSON.stringify({ name: 'quickjs-wasi', private: true, exports: { './quickjs.wasm': './quickjs.wasm' } }));
