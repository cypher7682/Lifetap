// Render PNG app icons from public/icons/icon.svg (dev-only; needs playwright).
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const svg = readFileSync(new URL("../public/icons/icon.svg", import.meta.url), "utf8");
const out = (n) => new URL(`../public/icons/${n}`, import.meta.url).pathname;
const b = await chromium.launch();
const p = await b.newPage();
async function shot(name, size, pad = 0, bg = "#0D0E11") {
  await p.setViewportSize({ width: size, height: size });
  const inner = size - pad * 2;
  await p.setContent(`<body style="margin:0;background:${bg}"><div style="padding:${pad}px">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div></body>`);
  await p.screenshot({ path: out(name), omitBackground: false });
}
await shot("icon-192.png", 192);
await shot("icon-512.png", 512);
await shot("icon-maskable-512.png", 512, 56);
await shot("apple-touch-icon.png", 180);
await b.close();
