export type RecentDirScenario = 'none' | 'few' | 'many'

const RECENT_DIR_SCENARIO_DATA: Record<RecentDirScenario, string[]> = {
  none: [],
  few: [
    '/Users/demo/projects/Phaneris',
    '/Users/demo/projects/Phaneris/apps/electron',
    '/Users/demo/projects/Phaneris/packages/shared',
  ],
  many: [
    '/Users/demo/projects/Phaneris',
    '/Users/demo/projects/Phaneris/apps/electron',
    '/Users/demo/projects/Phaneris/apps/viewer',
    '/Users/demo/projects/Phaneris/apps/cli',
    '/Users/demo/projects/Phaneris/packages/shared',
    '/Users/demo/projects/Phaneris/packages/server-core',
    '/Users/demo/projects/Phaneris/packages/pi-agent-server',
    '/Users/demo/projects/Phaneris/packages/ui',
    '/Users/demo/projects/Phaneris/scripts',
  ],
}

/** Return a copy of the fixture list for the selected scenario. */
export function getRecentDirsForScenario(scenario: RecentDirScenario): string[] {
  return [...RECENT_DIR_SCENARIO_DATA[scenario]]
}
