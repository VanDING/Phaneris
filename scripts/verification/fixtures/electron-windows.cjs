/** Startup feedback has no preload/RPC. Native business flows wait for the
 * actual workspace document, with the caller's existing timeout. */
async function firstBusinessWindow(application, { timeout = 30000 } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const page = application.windows().find(candidate => !candidate.isClosed()
      && /\/renderer\/index\.html(?:[?#]|$)/.test(candidate.url()))
    const startup = application.windows().some(candidate => !candidate.isClosed() && /\/startup\.html(?:[?#]|$)/.test(candidate.url()))
    if (page && !startup && await (await application.browserWindow(page)).evaluate(window => window.isVisible())) return page
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Workspace window did not open in ${timeout}ms`)
}
module.exports = { firstBusinessWindow }
