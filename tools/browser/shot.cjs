const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2], out = process.argv[3], wait = +(process.argv[4] || 3000), script = process.argv[5] || '';
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 700 } });
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await p.goto(url);
  await p.waitForTimeout(wait);
  if (script) { const r = await p.evaluate(script); if (r !== undefined) console.log('eval:', JSON.stringify(r)); }
  await p.waitForTimeout(500);
  await p.screenshot({ path: out });
  console.log(errs.slice(0, 15).join('\n') || 'no console errors');
  await b.close();
})();
