import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const origin = 'http://127.0.0.1:4200';
const output = 'verification-artifacts/issue-358';
await mkdir(output, { recursive: true });

const viewports = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 390, height: 844 },
};

const modes = ['confirm', 'add', 'edit'];
const themes = ['light', 'dark'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await chromium.launch({ headless: true });
try {
  for (const [viewportName, viewport] of Object.entries(viewports)) {
    for (const theme of themes) {
      for (const mode of modes) {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(String(error)));
        page.on('response', (response) => {
          if (
            response.status() >= 400 &&
            !response.url().includes('/api/assistant/status')
          ) {
            errors.push(`${response.status()} ${response.url()}`);
          }
        });

        await page.goto(`${origin}/__verify/dialog-actions?mode=${mode}`, {
          waitUntil: 'networkidle',
        });
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, theme);
        await page.waitForTimeout(300);

        const expectedRole = mode === 'confirm' ? 'alertdialog' : 'dialog';
        const dialog = page.locator(`[role="${expectedRole}"]`);
        assert((await dialog.count()) === 1, `${mode}/${theme}/${viewportName}: dialog role missing`);
        assert((await dialog.getAttribute('aria-modal')) === 'true', `${mode}: aria-modal missing`);

        const actions = page.locator('app-dialog-actions');
        assert((await actions.count()) === 1, `${mode}: DialogActions missing`);

        const dialogBox = await dialog.boundingBox();
        const actionBox = await actions.boundingBox();
        assert(dialogBox && actionBox, `${mode}: dialog/action geometry unavailable`);
        assert(actionBox.y >= dialogBox.y, `${mode}: actions start above dialog`);
        assert(
          actionBox.y + actionBox.height <= Math.min(viewport.height + 1, dialogBox.y + dialogBox.height + 1),
          `${mode}/${viewportName}: actions are not pinned inside the visible dialog`,
        );

        const horizontalOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        );
        assert(!horizontalOverflow, `${mode}/${viewportName}: horizontal page overflow`);

        const cancel = actions.getByRole('button', { name: 'Cancel' });
        assert((await cancel.count()) === 1, `${mode}: cancel action missing`);
        assert((await cancel.getAttribute('type')) === 'button', `${mode}: cancel lost button semantics`);
        assert(await cancel.evaluate((el) => el.classList.contains('nostos-button--secondary')), `${mode}: cancel is not canonical secondary appButton`);

        if (mode === 'confirm') {
          assert(await dialog.evaluate((el) => el.getAttribute('aria-labelledby') === 'confirm-dialog-title'), 'confirm: alertdialog label wiring changed');
          const destructive = actions.getByRole('button', { name: 'Delete Permanently' });
          assert((await destructive.count()) === 1, 'confirm: destructive action missing');
          assert(await destructive.evaluate((el) => el.classList.contains('nostos-button--danger')), 'confirm: destructive action is not canonical danger appButton');
          if (viewportName === 'mobile') {
            const direction = await actions.locator('.nostos-dialog-actions__end').evaluate(
              (el) => getComputedStyle(el).flexDirection,
            );
            assert(direction === 'column-reverse', 'confirm/mobile: actions do not stack');
          }
        } else {
          assert(await actions.evaluate((el) => el.classList.contains('nostos-dialog-actions--footer')), `${mode}: form actions are not footer variant`);
          const primary = actions.locator('button.nostos-button--primary');
          assert((await primary.count()) === 1, `${mode}: primary appButton missing`);
          assert((await primary.getAttribute('type')) === 'submit', `${mode}: submit semantics changed`);
          assert((await primary.getAttribute('form')) === 'add-book-form', `${mode}: external form association changed`);

          const deleteButton = actions.getByRole('button', { name: 'Delete Book' });
          if (mode === 'edit') {
            assert((await deleteButton.count()) === 1, 'edit: destructive leading action missing');
            assert(await deleteButton.evaluate((el) => el.hasAttribute('dialogActionsStart')), 'edit: destructive action not projected into start slot');
            assert(await deleteButton.evaluate((el) => el.classList.contains('nostos-button--danger')), 'edit: destructive action is not canonical danger appButton');
          } else {
            assert((await deleteButton.count()) === 0, 'add: edit-only destructive action leaked into create footer');
          }
        }

        const surface = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        console.log(JSON.stringify({
          viewport: viewportName,
          theme,
          mode,
          dialog: dialogBox,
          actions: actionBox,
          bodyBackground: surface,
          consoleErrors: errors,
        }));

        assert(errors.length === 0, `${mode}/${theme}/${viewportName}: browser errors: ${errors.join(' | ')}`);

        await page.screenshot({
          path: `${output}/${mode}-${theme}-${viewportName}.png`,
          fullPage: false,
        });
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
