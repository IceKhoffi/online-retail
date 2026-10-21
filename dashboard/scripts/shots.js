// shots.js - capture the built dashboard (served by the API on :8787)
// at desktop and phone widths into .tmp/shots/.
//
// The sandbox has no system fonts or fontconfig, so this script provisions
// both from the locally extracted Debian libs before launching Chromium.
import { chromium } from "playwright-core";
import { mkdir, writeFile, rm, cp } from "node:fs/promises";
import { join } from "node:path";

const BASE = "http://127.0.0.1:8787";
const outDir = ".tmp/shots";
await mkdir(outDir, { recursive: true });

// --- fontconfig provisioning (sandbox has no /etc/fonts) ---
// Chromium resolves generic families through fontconfig, whose fallback
// picked Liberation Mono (alphabetically first). Only offer the faces we
// want to render with: Sans + Serif, no Mono, under one clean dir.
const cwd = process.cwd();
const sansDir = ".tmp/debs/sans-fonts";
await rm(sansDir, { recursive: true, force: true });
await cp(join(cwd, ".tmp/debs/libs/usr/share/fonts/truetype/liberation"), sansDir, {
  recursive: true,
  filter: (f) => !/mono/i.test(f),
});
const fontDirs = [".tmp/debs/sans-fonts"];
const confPath = ".tmp/debs/fontconfig.conf";
await writeFile(
  confPath,
  `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
${fontDirs.map((d) => `  <dir>${join(cwd, d)}</dir>`).join("\n")}
  <cachedir>${join(cwd, ".tmp/debs/fontcache")}</cachedir>
  <match target="pattern">
    <test name="family"><string>sans-serif</string></test>
    <edit name="family" mode="prepend" binding="same"><string>Liberation Sans</string></edit>
  </match>
  <match target="pattern">
    <test name="family"><string>system-ui</string></test>
    <edit name="family" mode="prepend" binding="same"><string>Liberation Sans</string></edit>
  </match>
  <match target="pattern">
    <test name="family"><string>monospace</string></test>
    <edit name="family" mode="prepend" binding="same"><string>Liberation Sans</string></edit>
  </match>
</fontconfig>
`,
);
await mkdir(".tmp/debs/fontcache", { recursive: true });

const browser = await chromium.launch({
  env: {
    ...process.env,
    FONTCONFIG_FILE: `${cwd}/${confPath}`,
    LD_LIBRARY_PATH: [
      "debs/libs/usr/lib/x86_64-linux-gnu",
      "debs/libs/lib/x86_64-linux-gnu",
    ]
      .map((p) => `${cwd}/.tmp/${p}`)
      .join(":"),
  },
});
try {
  for (const [name, width, height] of [
    ["desktop", 1440, 900],
    ["phone", 390, 844],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on("console", (m) => {
      if (m.type() === "error") console.log(`[console:${name}]`, m.text());
    });
    page.on("pageerror", (e) => console.log(`[pageerror:${name}]`, e.message));
    await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1200); // charts settle
    await page.screenshot({ path: `${outDir}/${name}-1-top.png` });
    await page.screenshot({ path: `${outDir}/${name}-full.png`, fullPage: true });

    if (name === "desktop") {
      // hover a trend point and a heatmap cell, capture the bubbles
      const chart = await page.locator(".recharts-surface").first().boundingBox();
      if (chart) {
        await page.mouse.move(chart.x + chart.width * 0.62, chart.y + chart.height * 0.45);
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${outDir}/desktop-tooltip.png` });
      }
      const cellEl = page.locator(".hgrid-cell").nth(3 * 24 + 14); // Thu 14:00
      await cellEl.scrollIntoViewIfNeeded();
      await cellEl.hover();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${outDir}/desktop-heatmap-tip.png` });
    }

    console.log(name, "captured");
    await page.close();
  }
} finally {
  await browser.close();
}
