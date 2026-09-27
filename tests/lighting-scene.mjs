import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', message => {
    if (message.type() === 'error' && /shader|WebGLProgram/i.test(message.text())) errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:5180/lab');
  await page.waitForTimeout(6000);
  await page.screenshot({ path: 'tests/lighting-after-on.png' });
  await page.keyboard.press('F8');
  await page.getByRole('button', { name: 'Освещение', exact: true }).click();
  await page.getByRole('button', { name: 'Выключить все лампы', exact: true }).click();
  for (const checkbox of await page.getByRole('checkbox').all()) {
    if (await checkbox.isChecked()) throw Error('Light stayed enabled');
  }
  await page.keyboard.press('F8');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/lighting-after-off.png' });
  console.log(JSON.stringify({ errors, controls: 'all three light controls switched off' }));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
