import { createInterface, type Interface } from 'node:readline'

/** stdout is exclusively protocol. Parsing/dispatch does not own SDK or host state. */
export function createJsonlTransport<Message>() {
  let reader: Interface | null = null
  const send = (message: Message): void => { process.stdout.write(JSON.stringify(message) + '\n') }
  const debug = (message: string): void => { process.stderr.write(`[pi-server] ${message}\n`) }
  return {
    send, debug,
    listen(dispatch: (message: unknown) => Promise<void>, onClose: () => void, onError: (error: unknown) => void): void {
      if (reader) throw new Error('JSONL reader already started')
      reader = createInterface({ input: process.stdin })
      reader.on('line', (line: string) => {
        if (!line.trim()) return
        try { void dispatch(JSON.parse(line)).catch(onError) } catch (error) { debug(`Failed to parse JSONL: ${error}`) }
      })
      reader.on('close', onClose)
    },
  }
}
