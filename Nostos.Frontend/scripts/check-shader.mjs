
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
await page.goto('http://127.0.0.1:8085/index.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const info = await page.evaluate(() => {
  const c = document.querySelector('#paper-shader-container canvas');
  const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
  return {
    canvas: !!c,
    canvasSize: c ? [c.width, c.height] : null,
    shaderObject: !!window.nostosShader,
    hasWebgl: !!gl,
    themeFn: typeof window.updateShaderTheme,
  };
});
console.log(JSON.stringify(info, null, 1));
console.log('page errors/warnings:', errors.length ? errors : 'none');
await browser.close();
