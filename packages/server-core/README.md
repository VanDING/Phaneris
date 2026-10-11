# @phaneris/server-core

Runtime Host, product session orchestration and reusable WS/headless server infrastructure, shared by Electron and the headless server.

## Scope

- WS RPC transport primitives (`server`, `codec`, `types`, `capabilities`)
- Runtime platform contracts (`PlatformServices`) and headless implementation
- Generic handler dependency contracts
- Reusable headless bootstrap orchestration
- Durable Runtime Kernel/Host and external effect adapters (`durable-runtime/`, `runtime-adapters/`)
- Product session orchestration (`sessions/SessionManager.ts`), domain services and RPC handlers
- Task execution, decision accounting and Web UI HTTP/auth integration

## Out of scope

- Electron UI/main-process window management
- Renderer channel maps and generated client API wrappers
- Electron-specific platform implementations and browser window/tab services

Platform services are injected at bootstrap. Execution ownership belongs to the Runtime Host; SessionManager assembles product behavior through the restricted runtime APIs. See the [architecture overview](../../docs/architecture/overview.md) and [Runtime boundary](../../docs/architecture/durable-runtime-boundary.md).
