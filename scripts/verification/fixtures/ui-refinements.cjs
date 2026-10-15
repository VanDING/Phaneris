const assert = require('node:assert/strict');
const { writeFileSync, appendFileSync, readFileSync, existsSync, statSync } = require('node:fs');
const { join, resolve, sep, extname } = require('node:path');
const { createServer: createHttpServer } = require('node:http');
const { chromium } = require('playwright');
let reportStage = () => {};
async function warmThemePage(context, url, selector) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
    await page.locator(selector).first().waitFor({ timeout: 120000 });
    await page.evaluate(() => document.fonts.ready);
    assert.deepEqual(errors, []);
    return { url, errors };
  } finally { await page.close(); }
}
async function inspectFileIconPaint(page, run) {
  const paint = await page.locator('[data-all-file-icons] img').evaluateAll(async nodes => Promise.all(nodes.map(async image => {
    await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, 32, 32);
    const pixels = context.getImageData(0, 0, 32, 32).data;
    let visible = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) visible++;
    return { file: image.dataset.name, visiblePixels: visible };
  })));
  run.json('svg-paint.json', paint);
  assert(paint.length >= 91 && paint.every(icon => icon.visiblePixels > 0), 'Every SVG must paint inside its viewBox');
}

(async () => {
  const { root, prefix, output, channel } = JSON.parse(process.argv[2]);
  reportStage = value => appendFileSync(join(output, 'progress.log'), `${new Date().toISOString()} ${value}\n`);
  reportStage('load Vite configuration');
  const run = { directory: output, json: (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2)) };
  const { build, loadConfigFromFile } = await import('vite');
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, join(root, 'apps/electron/vite.config.ts'));
  reportStage('Vite configuration ready');
  assert(loaded, 'Renderer Vite configuration missing');
  const plugins = [];
  async function collect(values) {
    for (const value of values) {
      const plugin = await value;
      if (Array.isArray(plugin)) await collect(plugin);
      else if (!plugin || plugin.name !== '@rolldown/plugin-babel') plugins.push(plugin);
    }
  }
  await collect(loaded.config.plugins ?? []);
  const site = join(output, 'site');
  await build({ ...loaded.config, configFile: false, plugins, root, base: './',
    resolve: { ...loaded.config.resolve, alias: [
      { find: /^@\/contexts\/NavigationContext$/, replacement: join(root, 'scripts/verification/fixtures/ui-refinements-navigation.tsx') },
      { find: /^@phaneris\/ui$/, replacement: join(root, 'scripts/verification/fixtures/ui-refinements-ui.ts') },
      ...Object.entries(loaded.config.resolve.alias).map(([find, replacement]) => ({ find, replacement })),
    ] },
    build: { ...loaded.config.build, outDir: site, emptyOutDir: false, sourcemap: false,
      rolldownOptions: { input: join(output, 'index.html') } },
  });
  reportStage('Production fixture built');
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png' };
  const server = createHttpServer((request, response) => {
    const file = resolve(site, '.' + decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname));
    if (!file.startsWith(site + sep) || !existsSync(file) || !statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
    response.end(readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}${prefix}/index.html`;
  const browser = await chromium.launch({ headless: true, channel, timeout: 30000 });
  reportStage('Browser launched');
  const checks = [], errors = [], measurements = [];
  try {
    for (const scale of [1, 1.25, 1.5, 2]) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 1060 }, deviceScaleFactor: scale });
      try {
        if (scale === 1) {
          console.log("UI verification: preparing production components");
          run.json("preparation.json", await warmThemePage(context, url, "h1"));
          console.log("UI verification: components ready");
        }
        await context.tracing.start({ screenshots: true, snapshots: true });
        const page = await context.newPage();
        page.on("pageerror", (error) => errors.push(error.message));
        const external = [];
        page.on("request", (request) => {
          if (!request.url().startsWith("http://127.0.0.1:") && !request.url().startsWith("data:"))
            external.push(request.url());
        });
        await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
        await page.evaluate(() => document.fonts.ready);
        if (scale === 1) await inspectFileIconPaint(page, run);
        assert.equal(await page.locator('[data-native-icon] svg').evaluate(node => getComputedStyle(node).strokeWidth), '12px');
        const calendar = page.locator('[data-testid="activity"] [role="group"]');
        const day = calendar.locator("button").first();
        const box = await day.boundingBox();
        assert(box && box.width > 11 && Math.abs(box.width - box.height) < 0.1);
        assert.equal(await calendar.getByText("Less", { exact: true }).count(), 0);
        const firstKey = await day.getAttribute("data-activity-day");
        await day.focus();
        await page.keyboard.press("ArrowRight");
        assert.notEqual(await page.locator(":focus").getAttribute("data-activity-day"), firstKey);
        await page.keyboard.press("Enter");
        assert.equal(await calendar.locator('[aria-pressed="true"]').count(), 1);
        await page.getByRole("button", { name: "probe1.txt" }).click();
        for (const [name, icon] of [["apply-renshou-sale.py", "python"], ["probe1.txt", "document"], ["App.tsx", "react-ts"], ["app.d.ts", "typescript-def"], ["holdings.csv", "table"]]) {
          assert.equal(await page.getByRole("button", { name, exact: false }).locator("[data-file-icon]").getAttribute("data-file-icon"), icon);
        }
        assert.equal(await page.locator('[data-file-icon="folder-database-open"]').count(), 1);
        const images = await page.locator("[data-file-icon] img").evaluateAll((nodes) => nodes.map((node) => {
          const image = node;
          return { ok: image.complete && image.naturalWidth > 0, width: image.getBoundingClientRect().width };
        }));
        assert(images.every((image) => image.ok));
        const sidebarIcons = await page.locator(".sidebar-nav-button .navigation-icon svg").evaluateAll((nodes) => nodes.map((node) => ({
          width: node.getBoundingClientRect().width,
          height: node.getBoundingClientRect().height,
          stroke: getComputedStyle(node).strokeWidth,
          color: getComputedStyle(node).color
        })));
        assert.equal(sidebarIcons.length, 8);
        assert(sidebarIcons.every((icon) => icon.width === 16 && icon.height === 16 && icon.stroke === sidebarIcons[0].stroke));
        await page.getByRole("button", { name: "Session options" }).click();
        await page.locator('[role="menu"]').evaluate(async node => {
          await Promise.all(node.getAnimations().map(animation => animation.finished));
        });
        const menuIcons = await page.locator('[role="menu"] .menu-icon svg').evaluateAll((nodes) => nodes.map((node) => ({
          label: node.closest('[role="menuitem"]')?.textContent?.trim(),
          width: node.getBoundingClientRect().width,
          height: node.getBoundingClientRect().height,
          stroke: getComputedStyle(node).strokeWidth,
          color: getComputedStyle(node).color
        })));
        run.json(`${scale}-icon-parity.json`, { sidebarIcons, menuIcons });
        assert(menuIcons.length > 10);
        assert(menuIcons.every((icon) => Math.abs(icon.width - 16) < 0.01 && Math.abs(icon.height - 16) < 0.01 && icon.stroke === sidebarIcons[0].stroke));
        const neutralMenuIcon = menuIcons.find(icon => icon.label === "Rename");
        assert(neutralMenuIcon);
        assert(sidebarIcons.every(icon => icon.color === neutralMenuIcon.color), "Sidebar icon contrast should match the accepted session menu");
        await page.screenshot({ path: join(run.directory, `${scale}-light.png`) });
        await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
        await page.locator("output").filter({ hasText: "Rename selected" }).waitFor();
        await page.getByRole("button", { name: "Toggle sidebar" }).click();
        assert.equal(await page.locator(".sidebar-nav-button .navigation-icon svg").first().evaluate((node) => node.getBoundingClientRect().width), 16);
        const block = page.locator('[data-thinking-size="16"] rect').first();
        const transforms = new Set();
        for (let sample = 0; sample < 6; sample++) {
          transforms.add(await block.evaluate(node => getComputedStyle(node).transform));
          await page.waitForTimeout(160);
        }
        assert(transforms.size > 1);
        await page.emulateMedia({ reducedMotion: "reduce" });
        assert.equal(await block.evaluate((node) => getComputedStyle(node).animationName), "none");
        assert.equal(await page.locator('[data-thinking-size="16"] rect').count(), 9);
        await page.evaluate(() => document.documentElement.classList.add("dark"));
        await page.getByRole("button", { name: "Session options" }).click();
        await page.screenshot({ path: join(run.directory, `${scale}-dark-collapsed.png`) });
        await page.keyboard.press("Escape");
        await page.setViewportSize({ width: 880, height: 1060 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(await calendar.evaluate((node) => node.scrollWidth > node.clientWidth), false);
        assert.deepEqual(external, []);
        measurements.push({ scale, cell: box, sidebarIcons, menuIcons, loadedImages: images.length });
        checks.push(`${scale}-calendar-file-types-icon-parity-menu-interaction-reduced-motion-themes`);
        await context.tracing.stop({ path: join(run.directory, `${scale}-trace.zip`) });
      } finally {
        await context.close();
      }
    }
    assert.deepEqual(errors, []);
    run.json("ui-refinements.json", { checks, measurements, errors });
    console.log(JSON.stringify({ passed: checks.length, output }));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
