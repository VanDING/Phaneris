/** Browser text-entry values are execution inputs, never immutable audit data. */
const BROWSER_TOOL = /(?:^|__)browser_tool$/i;
// Accept quoted verbs too. False positives only hide audit text, never change execution.
const TEXT_ENTRY = /(?:^|[;\s"'])(?:fill|type|paste|set-clipboard)\b/i;

export function redactBrowserToolArguments(toolName: string, input: unknown): unknown {
  if (!BROWSER_TOOL.test(toolName.trim()) || !input || typeof input !== 'object' || Array.isArray(input)) return input;
  const args = input as Record<string, unknown>;
  const command = args.command;
  const entersText = typeof command === 'string' ? TEXT_ENTRY.test(command)
    : Array.isArray(command) && typeof command[0] === 'string' && /^\s*(fill|type|paste|set-clipboard)\s*$/i.test(command[0]);
  // Field type is unknown before dispatch: hide all entered text in storage.
  // The execution object and canonical argument hash remain exact.
  return entersText ? { ...args, command: '[browser text entry omitted from stored history]' } : input;
}

export function redactBrowserHistory<T>(value: T, depth = 0): T {
  if (depth > 32) return '[history nesting limit]' as T;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => redactBrowserHistory(item, depth + 1)) as T;
  const record = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) output[key] = redactBrowserHistory(item, depth + 1);
  const toolName = typeof record.toolName === 'string' ? record.toolName : typeof record.name === 'string' ? record.name : '';
  if (BROWSER_TOOL.test(toolName)) {
    for (const key of ['args', 'arguments', 'input', 'toolInput']) {
      if (output[key]) output[key] = redactBrowserToolArguments(toolName, output[key]);
    }
  }
  return output as T;
}
