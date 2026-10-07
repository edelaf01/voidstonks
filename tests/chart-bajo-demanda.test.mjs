import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { cargaScript } from "../deploy/js/utils/carga_script.js";

test("chart-bajo-demanda", async (t) => {
  await t.test("index.html no longer contains chart.js scripts", () => {
    const html = readFileSync(new URL("../deploy/index.html", import.meta.url), "utf8");
    assert.ok(!html.includes("cdn.jsdelivr.net/npm/chart.js"));
    const scriptSrcRegex = /<script\s+[^>]*src=["'][^"']*chart[^"']*["']/i;
    assert.ok(!scriptSrcRegex.test(html));
  });

  await t.test("vendored chart.js exists with correct hash", () => {
    const chartPath = new URL("../deploy/js/chart/4.5.1/chart.umd.min.js", import.meta.url);
    assert.ok(existsSync(chartPath));
    const content = readFileSync(chartPath);
    const hash = createHash("sha256").update(content).digest("hex");
    assert.equal(hash, "48444a82d4edcb5bec0f1965faacdde18d9c17db3063d042abada2f705c9f54a");
  });

  await t.test("ui_rivens.js points to the vendored chart.js", () => {
    const js = readFileSync(new URL("../deploy/js/ui.components/rivens/ui_rivens.js", import.meta.url), "utf8");
    assert.ok(js.includes('const CHART_JS = "js/chart/4.5.1/chart.umd.min.js"'));
    const match = js.match(/const CHART_JS = "(.*?)";/);
    assert.ok(match);
    const resolvedPath = new URL(`../deploy/${match[1]}`, import.meta.url);
    assert.ok(existsSync(resolvedPath));
  });

  await t.test("fetchAndRenderHistory and renderHistoryWithRange do not fabricate data", () => {
    const js = readFileSync(new URL("../deploy/js/ui.components/rivens/ui_rivens.js", import.meta.url), "utf8");
    
    const fetchStart = js.indexOf("async function fetchAndRenderHistory");
    const fetchEnd = js.indexOf("function changeHistoryRange", fetchStart);
    const fetchBlock = js.substring(fetchStart, fetchEnd);
    
    assert.ok(!fetchBlock.includes("Math.random"));
    assert.ok(!fetchBlock.includes("Math.sin"));
    assert.ok(!fetchBlock.includes("historyData = []"));
    
    const renderStart = js.indexOf("export function renderHistoryWithRange");
    let renderEnd = js.indexOf("\nfunction ", renderStart);
    const renderEndExport = js.indexOf("\nexport ", renderStart);
    if (renderEnd === -1 || (renderEndExport !== -1 && renderEndExport < renderEnd)) {
      renderEnd = renderEndExport;
    }
    const renderBlock = js.substring(renderStart, renderEnd);
    assert.ok(!renderBlock.includes("Math.random"));
  });

  await t.test("cargaScript works with a fake document", async () => {
    const appended = [];
    const doc = {
      createElement: () => ({
        src: "",
        onload: null,
        onerror: null,
        remove: function() {}
      }),
      head: {
        appendChild: (el) => appended.push(el)
      }
    };

    const p1 = cargaScript("url1", doc);
    const p2 = cargaScript("url1", doc);
    assert.equal(p1, p2);
    assert.equal(appended.length, 1);

    appended[0].onload();
    await p1;

    const p3 = cargaScript("url2", doc);
    assert.equal(appended.length, 2);

    let rejected = false;
    const p3Catch = p3.catch(() => { rejected = true; });
    appended[1].onerror();
    await p3Catch;
    assert.ok(rejected);

    cargaScript("url2", doc);
    assert.equal(appended.length, 3);
  });
});
