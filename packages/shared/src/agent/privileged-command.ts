import { parseSimpleCommand } from './bash-validator'

export interface PrivilegedCommand {
  kind: 'cask-install' | 'cask-upgrade' | 'installer'
  argv: string[]
  application: string
}

/** One command, with a bounded operation/argument vocabulary; never a prefix. */
export function parsePrivilegedCommand(command: string): PrivilegedCommand | null {
  const argv = parseSimpleCommand(command)
  if (!argv || argv.some(value => /[\x00-\x1f\x7f]/.test(value))) return null
  if (argv[0] === 'brew' && (argv[1] === 'install' || argv[1] === 'upgrade') && argv[2] === '--cask') {
    const flags = new Set(['--force', '--no-quarantine', '--require-sha', '--skip-cask-deps'])
    const applications = argv.slice(3).filter(value => !flags.has(value))
    if (!applications.length || applications.some(value => !/^[a-zA-Z0-9][a-zA-Z0-9+_.@/-]*$/.test(value))) return null
    return { kind: argv[1] === 'install' ? 'cask-install' : 'cask-upgrade', argv, application: applications[0]! }
  }
  if (argv.length === 5 && argv[0] === 'installer' && argv[1] === '-pkg' && argv[3] === '-target' && argv[4] === '/') {
    const path = argv[2]!
    if (!path.startsWith('-') && !path.startsWith('~') && /\.(?:m?pkg)$/i.test(path)) {
      return { kind: 'installer', argv, application: 'Installer Package' }
    }
  }
  return null
}

/** Quote parsed arguments for the shell, then quote the AppleScript as one argv. */
export function buildMacAdminCommand(command: PrivilegedCommand): string {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
  const shell = command.argv.map(quote).join(' ')
  const script = `do shell script "${shell.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}" with administrator privileges`
  return `osascript -e ${quote(script)}`
}
