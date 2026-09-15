
import { chromium } from '@playwright/test';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const out = process.argv[2];
  for (const [name, path, prep] of [
    ['read-bottom','/second-brain','reading'],
    ['library-bottom','/library',''],
    ['settings-bottom','/settings',''],
  ]) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.goto('http://127.0.0.1:5321'+path, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2300);
    if (prep === 'reading') {
      await p.locator('.index-item').first().click();
      await p.waitForTimeout(1800);
    }
    await p.evaluate(() => { for (const el of document.querySelectorAll('.workspace-content, .workspace-content *')) { try { if (el.scrollHeight>el.clientHeight+4) el.scrollTop=el.scrollHeight; } catch {} } });
    await p.waitForTimeout(1000);
    // Crop the bottom 45% so the dock area is the subject.
    const vh = 844;
    await p.screenshot({ path: `${out}/${name}.png`, clip: { x: 0, y: Math.round(vh*0.55), width: 390, height: Math.round(vh*0.45) } });
    await ctx.close();
  }
  await b.close();
})();
