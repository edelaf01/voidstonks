import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { stampContentHashes } from "../scripts-actu/build-dist.mjs";

const sha10 = (data) => createHash("sha256").update(data).digest("hex").slice(0, 10);
const stampOf = (content, path) => {
    const escaped = path.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    const m = new RegExp(`${escaped}\\?v=([\\da-f]+)`).exec(content);
    assert.notEqual(m, null, `no stamp for ${path} in: ${content}`);
    return m[1];
};

const site = (overrides = {}) => new Map(Object.entries({
    "index.html": '<link href="css/app.css?v=1.2"><script type="module" src="js/main.js?v=2.6.9"></script>',
    "css/app.css": "body{color:red}",
    "js/main.js": 'import{a}from"./utils/leaf.js";import{b}from"./other.js";',
    "js/utils/leaf.js": "export const a=1;",
    "js/other.js": "export const b=2;",
    ...overrides,
}));

describe("content hash stamps", () => {
    test("a leaf change reaches its importer and the html stamp", () => {
        const before = stampContentHashes(site()).files;
        const after = stampContentHashes(site({ "js/utils/leaf.js": "export const a=3;" })).files;

        assert.notEqual(stampOf(after.get("js/main.js"), "./utils/leaf.js"), stampOf(before.get("js/main.js"), "./utils/leaf.js"));
        assert.notEqual(stampOf(after.get("index.html"), "js/main.js"), stampOf(before.get("index.html"), "js/main.js"));
        assert.match(after.get("index.html"), /js\/main\.js\?v=[\da-f]{10}"/);
    });

    test("a change elsewhere keeps the other stamps byte-identical", () => {
        const before = stampContentHashes(site()).files;
        const after = stampContentHashes(site({ "js/other.js": "export const b=5;" })).files;

        assert.equal(stampOf(after.get("js/main.js"), "./utils/leaf.js"), stampOf(before.get("js/main.js"), "./utils/leaf.js"));
        assert.equal(stampOf(after.get("index.html"), "css/app.css"), stampOf(before.get("index.html"), "css/app.css"));
        assert.equal(after.get("js/utils/leaf.js"), before.get("js/utils/leaf.js"));
    });

    test("a file nobody references changes nothing else", () => {
        const before = stampContentHashes(site({ "js/orphan.js": "export const o=1;" })).files;
        const after = stampContentHashes(site({ "js/orphan.js": "export const o=2;" })).files;

        for (const [path, content] of before) {
            if (path !== "js/orphan.js") assert.equal(after.get(path), content, path);
        }
    });

    test("the same input gives the same output", () => {
        const a = stampContentHashes(site()).files;
        const b = stampContentHashes(new Map([...site()].reverse())).files;
        assert.deepEqual([...a].sort(), [...b].sort());
    });

    test("a cycle shares one hash and a change in one member renames the other", () => {
        const cycle = (aBody) => site({
            "js/main.js": 'import"./a.js";',
            "js/a.js": `import"./b.js?v=1.0";${aBody}`,
            "js/b.js": 'import"./a.js";export const b=1;',
        });
        const before = stampContentHashes(cycle("export const a=1;"));
        const after = stampContentHashes(cycle("export const a=2;"));

        const aStamp = stampOf(before.files.get("js/b.js"), "./a.js");
        assert.equal(stampOf(before.files.get("js/a.js"), "./b.js"), aStamp);
        assert.equal(before.hashes.get("js/a.js"), before.hashes.get("js/b.js"));
        assert.notEqual(stampOf(after.files.get("js/a.js"), "./b.js"), stampOf(before.files.get("js/a.js"), "./b.js"));
        assert.notEqual(stampOf(after.files.get("index.html"), "js/main.js"), stampOf(before.files.get("index.html"), "js/main.js"));
    });

    test("labels without ./ ../ js/ css/ are left alone", () => {
        const code = 'exposeGlobals(x,"main.js");log("scanner/live_scanner.js");';
        const out = stampContentHashes(site({ "js/main.js": code })).files;
        assert.equal(out.get("js/main.js"), code);
    });

    test("a js/ literal in a nested file resolves to the site root", () => {
        const lib = "/*! vendored */var T=1;";
        const out = stampContentHashes(
            site({ "js/x.min.js": lib, "js/repositories/ocr.js": 'const u="js/x.min.js";' }),
            new Set(["js/x.min.js"]),
        ).files;

        assert.equal(out.get("js/repositories/ocr.js"), `const u="js/x.min.js?v=${sha10(lib)}";`);
        assert.equal(out.has("js/x.min.js"), false);
    });

    test("an old manual stamp is replaced by the content hash", () => {
        const out = stampContentHashes(site()).files;
        assert.match(out.get("index.html"), new RegExp(`href="css/app\\.css\\?v=${sha10("body{color:red}")}"`));
        assert.equal(out.get("index.html").includes("?v=1.2"), false);
    });

    test("external urls are left alone", () => {
        const html = '<script src="https://cdn.example/y.js"></script><link href="//cdn.example/z.css">'
            + '<script src="http://cdn.example/b.js?v=1"></script>';
        const out = stampContentHashes(site({ "index.html": html })).files;
        assert.equal(out.get("index.html"), html);
    });

    test("a literal with no file behind it is left as is and reported", () => {
        const code = 'import("./missing.js?v=3");';
        const res = stampContentHashes(site({ "js/other.js": code }));
        assert.equal(res.files.get("js/other.js"), code);
        assert.deepEqual(res.unresolved, [{ from: "js/other.js", ref: "./missing.js?v=3" }]);
    });

    test("an inline import() in the html gets stamped", () => {
        const html = `<button onclick="import('./js/other.js')"></button>`;
        const out = stampContentHashes(site({ "index.html": html })).files;
        assert.match(out.get("index.html"), /import\('\.\/js\/other\.js\?v=[\da-f]{10}'\)/);
    });
});
