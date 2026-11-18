const assert = require("node:assert/strict");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("playwright");
const { serveRendererFixture } = require("./serve-renderer-fixture.cjs");
async function gotoWithRetry(page, url) {
  let failure;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 9e4 });
      return;
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}
;
(async () => {
  const { root, output } = JSON.parse(process.argv[2]);
  const run = { directory: output, json: (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2)), complete: (checks, untested) => writeFileSync(join(output, "browser-result.json"), JSON.stringify({ checks, untested }, null, 2)) };
  run.json("stage.json", { stage: "browser-launch" });
  const fixture = join(root, "scripts/verification/fixtures/sidebar-refinement.tsx");
  run.json("stage.json", { stage: "vite-build" });
  const server = await serveRendererFixture(root, output, fixture);
  const browser = await chromium.launch({ headless: true, channel: process.env.PHANERIS_TEST_BROWSER_CHANNEL, timeout: 3e4 });
  const launched = { browser, close: () => browser.close() };
  run.json("stage.json", { stage: "page-navigation" });
  const { url } = server;
  const page = await launched.browser.newPage({ viewport: { width: 1120, height: 820 } });
  const errors = [], scenes = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const measure = () => page.evaluate(() => {
    const sidebar = document.querySelector("[data-sidebar-fixture]");
    const main = sidebar.querySelector('nav[aria-label="Main navigation"]');
    const rows = [...main.querySelectorAll(":scope > .sidebar-section > button, :scope > .sidebar-section > [data-slot]")];
    const buttons = rows.length ? rows : [...main.querySelectorAll(":scope > .sidebar-section button.sidebar-nav-button")];
    const side = sidebar.getBoundingClientRect();
    const rounded = value => Math.round(value * 1000) / 1000;
    return {
      width: side.width,
      icons: buttons.map((button) => {
        const svg = button.querySelector("svg"), rect = svg.getBoundingClientRect(), row = button.getBoundingClientRect();
        return { name: button.getAttribute("aria-label"), size: rounded(rect.width), height: rounded(rect.height), x: rounded(rect.x - side.x + rect.width / 2), y: rounded(rect.y - side.y + rect.height / 2), row: rounded(row.height), color: getComputedStyle(svg).color, stroke: getComputedStyle(svg).strokeWidth };
      }),
      brand: document.querySelector("[data-brand] svg").getBoundingClientRect().height,
      menu: document.querySelector("[data-menu-icon]").getBoundingClientRect().width,
      separator: sidebar.querySelector(".sidebar-nav-separator")?.getBoundingClientRect().height ?? null,
      avatar: sidebar.querySelector(".sidebar-profile-avatar").getBoundingClientRect().width,
      settings: sidebar.querySelector(".sidebar-settings-trigger svg").getBoundingClientRect().width,
      newSession: (() => {
        const button = sidebar.querySelector(".sidebar-new-session");
        const style = getComputedStyle(button);
        return { background: style.backgroundColor, border: style.borderTop, iconX: rounded(button.querySelector("svg").getBoundingClientRect().left - side.left + 10) };
      })()
    };
  });
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const toggle = async (collapsed) => {
    await page.locator("[data-toggle-sidebar]").evaluate((button) => button.click());
    await page.waitForFunction((expected) => Math.abs(document.querySelector("[data-sidebar-fixture]").getBoundingClientRect().width - expected) < 0.1, collapsed ? 48 : 200);
    await settle();
  };
  const capture = async (name) => {
    await page.mouse.move(1e3, 750);
    await page.evaluate(() => document.fonts.ready);
    await settle();
    await page.screenshot({ path: join(run.directory, `${name}.png`) });
  };
  try {
    await gotoWithRetry(page, url);
    await page.locator(".sidebar-nav-button").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    run.json("stage.json", { stage: "page-assertions" });
    const expanded = await measure();
    await capture("light-expanded");
    if (process.env.PHANERIS_SIDEBAR_BASELINE === "1") {
      await toggle(true);
      run.json("geometry.json", { expanded, collapsed: await measure() });
      await capture("light-collapsed");
      run.complete(["baseline-production-components"], ["Baseline capture only; no acceptance assertions."]);
      return;
    }
    assert.equal(expanded.icons.length, 8);
    assert(expanded.icons.every((icon) => icon.size === 20 && icon.height === 20 && icon.row === 34), JSON.stringify(expanded));
    assert.equal(expanded.icons[1].y - expanded.icons[0].y, 36);
    assert.equal(expanded.separator, 5);
    assert.equal(expanded.menu, 16);
    assert.equal(expanded.avatar, 22);
    assert.equal(expanded.settings, 20);
    assert.notEqual(expanded.newSession.background, "rgba(0, 0, 0, 0)");
    assert.match(expanded.newSession.border, /^1px solid /);
    assert.equal(expanded.newSession.iconX, 24);
    scenes.push("shared-main-icon-scale-and-rhythm", "compact-light-separator", "menu-scale-isolated", "new-session-card-and-border");
    const sources = page.getByRole("button", { name: "Sources", exact: true });
    await sources.focus();
    await sources.evaluate((button) => button.setAttribute("data-continuity", "retained"));
    await toggle(true);
    const collapsed = await measure();
    assert.equal(collapsed.width, 48);
    assert.deepEqual(collapsed.icons, expanded.icons);
    assert.equal(collapsed.brand, expanded.brand);
    assert.equal(collapsed.menu, 16);
    assert.equal(collapsed.avatar, 22);
    assert.equal(collapsed.settings, 20);
    assert.deepEqual(collapsed.newSession, expanded.newSession);
    assert.equal(await sources.getAttribute("data-continuity"), "retained");
    assert.equal(await sources.evaluate((button) => document.activeElement === button), true);
    assert(collapsed.icons.every((icon) => Math.abs(icon.x - 24) < 0.1));
    scenes.push("both-states-keep-icon-size-and-position", "brand-unchanged", "button-and-focus-continuity");
    await sources.hover();
    await page.getByRole("tooltip", { name: "Sources", exact: true }).waitFor();
    await capture("light-collapsed");
    await toggle(false);
    await page.mouse.move(1e3, 750);
    await page.waitForFunction(() => ![...document.querySelectorAll('[role="tooltip"]')].some((node) => node.textContent === "Sources"));
    scenes.push("collapsed-tooltip-without-expanded-residue");
    await page.locator('.sidebar-nav-button[aria-label="Sessions"] [data-no-dnd]').click();
    const child = page.getByRole("button", { name: "Completed", exact: true });
    await child.waitFor();
    assert(Math.abs(await child.locator("svg").first().evaluate((svg) => svg.getBoundingClientRect().width) - 14) < 0.01);
    const semanticColor = await child.locator("svg").first().evaluate((svg) => getComputedStyle(svg).color);
    assert.notEqual(semanticColor, expanded.icons[1].color);
    await toggle(true);
    await child.waitFor({ state: "hidden" });
    await toggle(false);
    await child.waitFor();
    scenes.push("nested-scale-semantic-color-and-state-preserved");
    await child.click();
    assert.equal(await page.locator("[data-selection]").textContent(), "Completed");
    await page.locator('.sidebar-nav-button[aria-label="Sessions"] [data-no-dnd]').click();
    await child.waitFor({ state: "hidden" });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await capture("dark-expanded");
    await toggle(true);
    await capture("dark-collapsed");
    scenes.push("dark-and-light-rendering");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await toggle(false);
    assert((await sources.evaluate((button) => parseFloat(getComputedStyle(button).transitionDuration))) <= 0.001);
    await sources.focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("[data-selection]").textContent(), "Sources");
    scenes.push("reduced-motion-and-keyboard-activation");
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "18px";
      document.documentElement.style.setProperty("--theme-density-scale", "1.125");
    });
    await settle();
    const largeExpanded = await measure();
    await toggle(true);
    const largeCollapsed = await measure();
    run.json("geometry.json", { expanded, collapsed, largeExpanded, largeCollapsed });
    const glyphPositions = geometry => geometry.icons.map(({name,size,height,x,y}) => ({name,size,height,x,y}));
    assert.deepEqual(glyphPositions(largeCollapsed), glyphPositions(largeExpanded));
    scenes.push("large-type-and-density-centers-preserved");
    run.json("geometry.json", { expanded, collapsed, largeExpanded, largeCollapsed });
    const touch = await launched.browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await gotoWithRetry(touch, url);
    const target = touch.locator(".sidebar-new-session");
    await target.waitFor();
    assert((await target.boundingBox()).height >= 44);
    await touch.locator("[data-toggle-sidebar]").click();
    await touch.waitForFunction(() => Math.abs(document.querySelector("[data-sidebar-fixture]").getBoundingClientRect().width - 60) < 0.1);
    assert(Math.abs(await touch.locator(".navigation-icon svg").first().evaluate((svg) => svg.getBoundingClientRect().width) - 20) < 0.01);
    await touch.screenshot({ path: join(run.directory, "touch-rail.png") });
    await touch.close();
    scenes.push("touch-targets-and-icon-scale");
    assert.deepEqual(errors, []);
    run.complete(scenes, ["Real production React components and Electron CSS in Chromium; full native shell, signed installers and physical displays are outside this workflow."]);
    console.log(JSON.stringify({ output: run.directory, scenes: scenes.length }));
  } finally {
    await page.close();
    await launched.close();
    await server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
