import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Required loose subprocess resources in a standalone production distribution. */
export function assertProductionRuntimeResources(resources: string, appRoot: string, workerPath?: string): void {
  const required = [
    join(resources, 'pi-agent-server', 'index.js'),
    join(resources, 'pi-agent-server', 'bundle.js'),
    join(resources, 'pi-agent-server', 'worker.js'),
    join(resources, 'pi-agent-server', 'node_modules', 'quickjs-wasi', 'quickjs.wasm'),
    workerPath ?? join(appRoot, 'packages', 'messaging-whatsapp-worker', 'dist', 'worker.cjs'),
  ]
  for (const path of required) {
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Missing production runtime resource: ${path}`)
  }
}
