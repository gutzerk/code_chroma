const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (err) => console.log('PAGEERROR:', err.message));
  await page.goto('http://localhost:5183/?autoexpand=off');
  await page.waitForSelector('[data-testid="app-root"]');

  const result = await page.evaluate(async () => {
    const canvasDocMod = await import('/src/canvas/doc/canvasDocStore.ts');
    const mockMod = await import('/src/engine-client/mockBridge.ts');
    const client = new mockMod.MockBridgeEngineClient();

    // Two boxes side by side, horizontal edge A -> B. B has a very long one-line name/description
    // so it should grow past the 220x72 default -- we want to see which direction it grows and
    // whether the arrow/label tracks that growth correctly.
    const ops = [
      {
        op: 'add_element', temp_id: 'A', render: 'c1', label: 'Short A',
        description: '', position: { x: 200, y: 200 }, layer: 'test',
      },
      {
        op: 'add_element', temp_id: 'B', render: 'c1',
        label: 'A Very Long Title That Should Force This Box To Grow Wider Than Two Hundred And Twenty Pixels Of Default Width',
        description: 'And also a fairly long description sentence, to see if this affects height growth as well as width in this box.',
        position: { x: 700, y: 200 }, layer: 'test',
      },
      { op: 'add_edge', from: 'A', to: 'B', label: 'Calls', kind: 'uses' },
    ];
    const batchResult = await client.patchCanvas({ ops, layer: 'test', explanation: 'repro' });
    const doc = await client.getCanvas();
    canvasDocMod.canvasDocStore.setDoc(doc);
    return { batchResult, elementIds: Object.keys(doc.elements) };
  });
  console.log('setup result:', JSON.stringify(result));

  await page.waitForTimeout(1200);

  const fitAll = page.getByText('Fit All');
  if (await fitAll.count() > 0) {
    await fitAll.click();
    await page.waitForTimeout(500);
  }

  await page.screenshot({ path: '/private/tmp/claude-501/-Users-dmitriiushakov-PycharmProjects-PythonProject-CD/8eee2a30-28e3-4092-a01b-219b43871d02/scratchpad/repro2-full.png', fullPage: true });

  const debugInfo = await page.evaluate(() => {
    function overlap(a, b) {
      return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    }
    const boxes = [...document.querySelectorAll('[data-testid="canvas-node-box"]')].map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        text: el.textContent.slice(0, 20), x: r.x, y: r.y, w: r.width, h: r.height,
        inlineLeft: el.style.left, inlineTop: el.style.top, inlineMinWidth: el.style.minWidth, inlineMinHeight: el.style.minHeight,
        computedWidth: cs.width, computedHeight: cs.height, boxSizing: cs.boxSizing,
        paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom,
        borderLeft: cs.borderLeftWidth, borderRight: cs.borderRightWidth, borderTop: cs.borderTopWidth, borderBottom: cs.borderBottomWidth,
      };
    });
    const edges = [...document.querySelectorAll('[data-testid="canvas-doc-relationship"]')].map((g) => {
      const path = g.querySelector('.c1-relationship-path');
      const chip = g.querySelector('.connector-label-chip');
      const chipRect = chip?.getBoundingClientRect();
      const pathRect = path?.getBoundingClientRect();
      return {
        d: path?.getAttribute('d'),
        pathScreenRect: pathRect && { x: pathRect.x, y: pathRect.y, w: pathRect.width, h: pathRect.height },
        chipRect: chipRect && { x: chipRect.x, y: chipRect.y, w: chipRect.width, h: chipRect.height },
      };
    });
    return { boxes, edges };
  });
  console.log('debugInfo:', JSON.stringify(debugInfo, null, 2));

  await browser.close();
})();
