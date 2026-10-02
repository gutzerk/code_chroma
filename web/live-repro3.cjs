const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } });
  page.on('pageerror', (err) => console.log('PAGEERROR:', err.message));
  await page.goto('http://localhost:5183/?autoexpand=off');
  await page.waitForSelector('[data-testid="app-root"]');

  const setup = await page.evaluate(async () => {
    const canvasDocMod = await import('/src/canvas/doc/canvasDocStore.ts');
    const mockMod = await import('/src/engine-client/mockBridge.ts');
    const recipeMod = await import('/src/canvas/doc/RecipeMenu.tsx');
    const client = new mockMod.MockBridgeEngineClient();
    const r1 = await recipeMod.runRecipeAndLayout(client, 'c1');
    const r2 = await recipeMod.runRecipeAndLayout(client, 'patterns');
    return { r1, r2 };
  });
  console.log('setup:', JSON.stringify(setup));

  await page.waitForTimeout(1500);
  const fitAll = page.getByText('Fit All');
  if (await fitAll.count() > 0) { await fitAll.click(); await page.waitForTimeout(500); }

  const analysis = await page.evaluate(() => {
    function endpointsFor(edgeEl) {
      const path = edgeEl.querySelector('.c1-relationship-path');
      const d = path.getAttribute('d');
      const nums = d.match(/-?[\d.]+/g).map(Number);
      // d starts "M x y ..." and ends with the last "L x y"
      const start = { x: nums[0], y: nums[1] };
      const end = { x: nums[nums.length - 2], y: nums[nums.length - 1] };
      return { d, start, end };
    }
    // Map each rendered box's screen rect, keyed by its node-id/select-id.
    const boxes = [...document.querySelectorAll('[data-testid="canvas-node-box"]')].map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        id: el.getAttribute('data-select-id'), text: el.textContent.slice(0, 25),
        rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        render: el.getAttribute('data-render'),
        inlineLeft: el.style.left, inlineTop: el.style.top,
        margin: cs.margin, boxSizing: cs.boxSizing,
        borderTop: cs.borderTopWidth, borderBottom: cs.borderBottomWidth,
      };
    });
    // Screen->SVG-local transform: read the ctm of the relationship svg group.
    const svg = document.querySelector('.c1-relationships') || document.querySelector('[data-testid="canvas-doc-view"] svg');
    const ctm = svg ? svg.getScreenCTM() : null;
    function localToScreen(pt) {
      if (!ctm) return pt;
      const domPoint = new DOMPoint(pt.x, pt.y).matrixTransform(ctm);
      return { x: domPoint.x, y: domPoint.y };
    }
    const edges = [...document.querySelectorAll('[data-testid="canvas-doc-relationship"]')].map((g) => {
      const { d, start, end } = endpointsFor(g);
      return { d, startScreen: localToScreen(start), endScreen: localToScreen(end) };
    });
    function insetOf(point, rect, margin = 0.5) {
      // positive = inside the box by that many px; negative = outside (gap) by that many px.
      const dx = Math.min(point.x - rect.left, rect.right - point.x);
      const dy = Math.min(point.y - rect.top, rect.bottom - point.y);
      return Math.min(dx, dy);
    }
    const results = edges.map((e) => {
      const distances = boxes.map((b) => ({
        id: b.id, text: b.text,
        startInset: insetOf(e.startScreen, b.rect),
        endInset: insetOf(e.endScreen, b.rect),
      }));
      // The relevant box for each endpoint is whichever one it's nearest to (smallest |inset|).
      const nearestStart = distances.slice().sort((a, b2) => Math.abs(a.startInset) - Math.abs(b2.startInset))[0];
      const nearestEnd = distances.slice().sort((a, b2) => Math.abs(a.endInset) - Math.abs(b2.endInset))[0];
      return {
        d: e.d,
        startBox: nearestStart.text, startInset: Math.round(nearestStart.startInset * 10) / 10,
        endBox: nearestEnd.text, endInset: Math.round(nearestEnd.endInset * 10) / 10,
      };
    });
    return results;
  });
  console.log('analysis:', JSON.stringify(analysis, null, 2));

  const boxDump = await page.evaluate(() => {
    return [...document.querySelectorAll('[data-testid="canvas-node-box"]')].map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        text: el.textContent.slice(0, 20), render: el.getAttribute('data-render'),
        inlineLeft: el.style.left, inlineTop: el.style.top,
        rectTop: r.top, rectLeft: r.left,
        margin: cs.margin, boxSizing: cs.boxSizing, borderTop: cs.borderTopWidth,
      };
    });
  });
  console.log('boxDump:', JSON.stringify(boxDump, null, 2));

  await browser.close();
})();
