import { deleteProject, loadProject, loadWorkspaceProjects, type LoadedProject } from '@phaneris/shared/projects'

interface ProjectMutationHost {
  ready(): Promise<void>
  unbindSessions(projectId: string): Promise<void>
  unbindPages(projectId: string): Promise<void>
  changed(projects: LoadedProject[]): void
  log(message: string): void
}

/** Deletion is retryable: retain the project until every reference is released.
 * Completed releases remain visible even if a later file operation fails. */
export function createWorkspaceProjects(root: string, host: ProjectMutationHost) {
  let pending = Promise.resolve()
  return {
    remove(slug: string): Promise<void> {
      const operation = pending.then(async () => {
        await host.ready()
        const project = loadProject(root, slug)
        if (!project) return // Legacy missing-project deletion returns void.
        await host.unbindSessions(project.config.id)
        await host.unbindPages(project.config.id)
        deleteProject(root, slug)
        // Commit already happened. A push failure must not invite a destructive retry.
        try { host.changed(loadWorkspaceProjects(root)) }
        catch (error) { host.log(`Project ${slug} deleted; notification needs refresh: ${String(error)}`) }
      })
      pending = operation.catch(() => {})
      return operation
    },
  }
}

export type WorkspaceProjects = ReturnType<typeof createWorkspaceProjects>
