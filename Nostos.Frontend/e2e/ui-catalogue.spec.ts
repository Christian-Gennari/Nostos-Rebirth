import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { loadFixture } from './support/fixture';

const OUT = path.join(__dirname, 'test-results', 'ui-catalogue');

const CASES = [
  { name: 'desktop-light', width: 1280, height: 800, theme: 'light' as const },
  { name: 'desktop-dark', width: 1280, height: 800, theme: 'dark' as const },
  { name: 'mobile-light', width: 390, height: 844, theme: 'light' as const },
  { name: 'mobile-dark', width: 390, height: 844, theme: 'dark' as const },
];

test.describe('Nostos UI v1 catalogue', () => {
  for (const tc of CASES) {
    test(tc.name, async ({ browser }) => {
      mkdirSync(OUT, { recursive: true });
      const fixture = loadFixture();
      const context = await browser.newContext({
        viewport: { width: tc.width, height: tc.height },
        deviceScaleFactor: 1,
        isMobile: tc.width < 768,
        hasTouch: tc.width < 768,
      });

      await context.addInitScript((theme: 'light' | 'dark') => {
        localStorage.setItem('nostos.theme', theme);
      }, tc.theme);

      const page = await context.newPage();
      try {
        await page.goto(`${fixture.baseUrl}/ui-catalogue`, { waitUntil: 'domcontentloaded' });
        const catalogue = page.getByTestId('ui-catalogue');
        await expect(catalogue).toBeVisible();

        if (tc.theme === 'dark') {
          await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        } else {
          await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
        }

        await expect(page.locator('button.nostos-button--primary').first()).toBeVisible();
        await expect(page.locator('button.icon-btn')).toHaveCount(6);
        await expect(page.locator('.nostos-form-control')).toHaveCount(7);
        await expect(page.locator('.nostos-switch')).toHaveCount(3);
        await expect(page.locator('.nostos-chip')).toHaveCount(4);
        await expect(page.locator('.nostos-badge')).toHaveCount(4);

        await expect(page.getByRole('button', { name: 'Saving…' })).toHaveAttribute(
          'aria-busy',
          'true',
        );
        await expect(page.locator('#catalogue-author')).toHaveAttribute('aria-invalid', 'true');
        await expect(page.getByLabel('Checked switch example', { exact: true })).toBeChecked();
        await expect(page.getByRole('button', { name: 'Selected' })).toHaveAttribute(
          'aria-pressed',
          'true',
        );

        const tablist = page.getByRole('tablist', { name: 'Catalogue tab example' });
        await expect(tablist).toBeVisible();
        await tablist.getByRole('tab', { name: 'Patterns' }).click();
        await expect(tablist.getByRole('tab', { name: 'Patterns' })).toHaveAttribute(
          'aria-selected',
          'true',
        );

        const viewGroup = page.getByRole('group', { name: 'Catalogue view example' });
        await viewGroup.getByRole('button', { name: 'Grid' }).click();
        await expect(viewGroup.getByRole('button', { name: 'Grid' })).toHaveAttribute(
          'aria-pressed',
          'true',
        );

        const secondary = page.getByTestId('secondary-button');
        const rest = await secondary.evaluate((el) => {
          const style = getComputedStyle(el);
          return { background: style.backgroundColor, color: style.color };
        });
        await secondary.hover();
        await page.waitForTimeout(220);
        const hovered = await secondary.evaluate((el) => {
          const style = getComputedStyle(el);
          return { background: style.backgroundColor, color: style.color };
        });
        expect(hovered).not.toEqual(rest);

        const title = page.locator('#catalogue-title');
        await title.focus();
        const focus = await title.evaluate((el) => {
          const style = getComputedStyle(el);
          return {
            outlineStyle: style.outlineStyle,
            outlineWidth: style.outlineWidth,
            outlineColor: style.outlineColor,
          };
        });
        expect(focus.outlineStyle).not.toBe('none');
        expect(parseFloat(focus.outlineWidth)).toBeGreaterThanOrEqual(2);

        const overflow = await page.evaluate(() => ({
          document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          body: document.body.scrollWidth - document.body.clientWidth,
        }));
        expect(overflow.document).toBeLessThanOrEqual(1);
        expect(overflow.body).toBeLessThanOrEqual(1);

        await page.screenshot({
          path: path.join(OUT, `${tc.name}.png`),
          fullPage: true,
          animations: 'disabled',
        });

        await page.getByRole('button', { name: 'Open modal example' }).click();
        const dialog = page.getByRole('dialog', { name: 'Archive note?' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Archive' })).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();

        await page.screenshot({
          path: path.join(OUT, `${tc.name}-modal.png`),
          fullPage: false,
          animations: 'disabled',
        });

        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).toBeHidden();
      } finally {
        await context.close();
      }
    });
  }
});
