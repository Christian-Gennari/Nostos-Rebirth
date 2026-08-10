/**
 * Global teardown for Task 13 Playwright: stop the fixture backend and
 * remove the temp DB/wwwroot (backend.log is preserved under e2e/test-results).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export default function globalTeardown(): void {
  const launcher = path.join(__dirname, 'launch-fixture.mjs');
  const result = spawnSync(process.execPath, [launcher, 'kill'], {
    stdio: 'inherit',
    timeout: 120_000,
  });
  if (result.status !== 0) {
    console.error(`[global-teardown] fixture kill exited ${result.status} (non-fatal).`);
  }
}
