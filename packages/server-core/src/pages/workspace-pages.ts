import {
  createPage, updatePage, savePageContent, loadPage, loadWorkspacePages,
  writePageData, deletePageWithUnpublish, addPageGrant, revokePageGrant,
  PagePublisher, createCredentialPagePublishTokenStore,
  type LoadedPage, type CreatePageInput, type UpdatePagePatch, type AddPageGrantInput,
} from '@phaneris/shared/pages'

export interface PageMutationHost {
  notify(relativePath: string): void
  changed(pages: LoadedPage[]): void
  thumbnail?(slug: string): void
  log?(message: string): void
}

/** One workspace owns persistence and the observable completion of a mutation. */
export function createWorkspacePages(workspace: { id: string; rootPath: string }, host: PageMutationHost) {
  const root = workspace.rootPath
  let publishedList: string | undefined
  function publishList(pages = loadWorkspacePages(root)): void {
    const signature = JSON.stringify(pages)
    if (signature === publishedList) return
    host.changed(pages)
    publishedList = signature
  }
  async function complete(slug: string, contentChanged = false): Promise<void> {
    // These effects follow a committed product mutation. A notification failure
    // must not make a caller repeat an already successful publication or write.
    for (const effect of [() => host.notify(`pages/${slug}/page.json`), () => publishList(),
      ...(contentChanged ? [() => host.thumbnail?.(slug)] : [])]) {
      try { effect() }
      catch (error) { host.log?.(`Pages committed ${slug}; notification needs refresh: ${error instanceof Error ? error.message : String(error)}`) }
    }
  }
  function publisher(): PagePublisher {
    return new PagePublisher({ tokenStore: createCredentialPagePublishTokenStore(), log: host.log })
  }
  return {
    publishList,
    async create(input: CreatePageInput) {
      const page = createPage(root, input)
      await complete(page.slug, input.content !== undefined)
      return page
    },
    async update(slug: string, patch: UpdatePagePatch, content?: string) {
      const existing = loadPage(root, slug)
      if (!existing) throw new Error(`Page not found: ${slug}`)
      let config = existing.config
      if (Object.keys(patch).length || content === undefined) config = updatePage(root, slug, patch)
      if (content !== undefined) config = savePageContent(root, slug, content)
      await complete(slug, content !== undefined)
      return config
    },
    async writeContent(slug: string, content: string) {
      const page = savePageContent(root, slug, content)
      await complete(slug, true)
      return page
    },
    async writeData(slug: string, patch: Parameters<typeof writePageData>[2]) {
      const outcome = await writePageData(root, slug, patch)
      await complete(slug)
      return outcome
    },
    async remove(slug: string) {
      const outcome = await deletePageWithUnpublish(root, workspace.id, slug, { log: host.log })
      await complete(slug)
      return outcome
    },
    async unbindProject(projectId: string): Promise<void> {
      const committed: string[] = []
      try {
        for (const page of loadWorkspacePages(root)) {
          if (page.config.projectId !== projectId) continue
          updatePage(root, page.config.slug, { projectId: null })
          committed.push(page.config.slug)
        }
      } finally {
        // Earlier releases are durable even when a later page is locked.
        for (const slug of committed) await complete(slug)
      }
    },
    async issueGrant(slug: string, input: AddPageGrantInput) {
      const grant = addPageGrant(root, slug, input)
      await complete(slug)
      return grant
    },
    async revokeGrant(slug: string, grantId: string) {
      const removed = revokePageGrant(root, slug, grantId)
      if (removed) await complete(slug)
      return removed
    },
    async publish(slug: string, options: Parameters<PagePublisher['publish']>[3]) {
      const page = await publisher().publish(root, workspace.id, slug, options)
      await complete(slug)
      return page
    },
    async setPassword(slug: string, password: string | null) {
      const page = await publisher().setPassword(root, workspace.id, slug, password)
      await complete(slug)
      return page
    },
    async unpublish(slug: string) {
      const result = await publisher().unpublish(root, workspace.id, slug)
      await complete(slug)
      return { config: result.config, warning: result.warning }
    },
  }
}

export type WorkspacePages = ReturnType<typeof createWorkspacePages>
/** Agent tools cannot grant actions or publish a page. */
export type AgentPageMutations = Pick<WorkspacePages, 'create' | 'update' | 'writeData' | 'remove'>
