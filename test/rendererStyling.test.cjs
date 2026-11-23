const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const stylesheetPath = path.join(root, "src", "renderer", "styles.css");
const stylesheet = fs.readFileSync(stylesheetPath, "utf8");

function extractLayer(source, layerName) {
  const marker = `@layer ${layerName} {`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${layerName} layer`);
  let depth = 0;
  let opened = false;
  for (let index = start + marker.length - 1; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
      opened = true;
    } else if (source[index] === "}") {
      depth -= 1;
      if (opened && depth === 0) {
        return source.slice(start + marker.length, index);
      }
    }
  }
  throw new Error(`unterminated ${layerName} layer`);
}

test("renderer stylesheet declares the agreed layer order", () => {
  assert.match(
    stylesheet,
    /@layer reset, tokens, primitives, components, views, responsive, utilities;/,
  );
  for (const layer of ["reset", "tokens", "primitives", "components", "views", "responsive", "utilities"]) {
    assert.match(stylesheet, new RegExp(`@layer ${layer} \\{`));
  }
});

test("renderer CSS rules are contained by named layers", () => {
  const source = stylesheet.replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0;
  const unlayered = [];
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (depth === 0 && trimmed && !/^@layer (?:reset,|(?:reset|tokens|primitives|components|views|responsive|utilities) \{)/.test(trimmed)) {
      unlayered.push(trimmed);
    }
    depth += (line.match(/\{/g) || []).length;
    depth -= (line.match(/\}/g) || []).length;
  }
  assert.deepEqual(unlayered, []);
  assert.equal(depth, 0);
});

test("all referenced Creator Workbench tokens are declared", () => {
  const declared = new Set([...stylesheet.matchAll(/(--cw-[a-z0-9-]+)\s*:/gi)].map((match) => match[1]));
  const referenced = new Set([...stylesheet.matchAll(/var\(\s*(--cw-[a-z0-9-]+)/gi)].map((match) => match[1]));
  const missing = [...referenced].filter((token) => !declared.has(token));
  assert.deepEqual(missing, []);
  assert.doesNotMatch(stylesheet, /var\(\s*--(?:border-color|muted-text)\b/);
});

test("core palette literals stay centralized in the token layer", () => {
  const tokenLayer = extractLayer(stylesheet, "tokens");
  const outsideTokens = stylesheet.replace(tokenLayer, "");
  const corePalette = [
    "#09070f",
    "#12101a",
    "#1a1625",
    "#211b30",
    "#f6f1ff",
    "#a9a0b8",
    "#746b85",
    "#b86cff",
    "#d8a7ff",
    "#d7b5ff",
    "#73e2b0",
    "#f5c76f",
    "#ff7d98",
    "#eef2f7",
    "#dfe7f1",
    "#d7dee9",
    "#95a1b3",
    "#8b96a7",
    "#78d4ff",
    "#9dd1ff",
    "#3f7cff",
    "#d49cff",
    "#d7b0ff",
    "#9ce3b7",
    "#ffd77a",
    "#ffb4c4",
    "#05070a",
    "#0d0a14",
    "#302445",
    "rgba(255, 255, 255, 0.025)",
    "rgba(255, 255, 255, 0.03)",
    "rgba(255, 255, 255, 0.04)",
    "rgba(255, 255, 255, 0.05)",
    "rgba(255, 255, 255, 0.06)",
    "rgba(255, 255, 255, 0.07)",
    "rgba(255, 255, 255, 0.08)",
    "rgba(255, 255, 255, 0.09)",
    "rgba(255, 255, 255, 0.1)",
    "rgba(214, 184, 255, 0.1)",
    "rgba(214, 184, 255, 0.12)",
    "rgba(214, 184, 255, 0.14)",
    "rgba(214, 184, 255, 0.2)",
    "rgba(198, 137, 255, 0.38)",
    "rgba(7, 10, 15, 0.52)",
    "rgba(7, 10, 15, 0.72)",
    "rgba(120, 212, 255, 0.08)",
    "rgba(120, 212, 255, 0.12)",
    "rgba(120, 212, 255, 0.14)",
    "rgba(184, 108, 255, 0.08)",
    "rgba(184, 108, 255, 0.1)",
    "rgba(184, 108, 255, 0.12)",
    "rgba(184, 108, 255, 0.22)",
    "rgba(184, 108, 255, 0.34)",
    "rgba(184, 108, 255, 0.55)",
    "rgba(171, 113, 255, 0.08)",
    "rgba(171, 113, 255, 0.2)",
    "rgba(60, 180, 112, 0.1)",
    "rgba(60, 180, 112, 0.16)",
    "rgba(232, 98, 98, 0.16)",
    "rgba(0, 0, 0, 0.16)",
    "#aaa1ba",
    "#a9a1b9",
    "#8be4b5",
    "#ffd08a",
    "#e3eaf3",
    "#93e7b3",
    "#d9bcff",
    "#ffb0b0",
    "#ffbcbc",
  ];

  for (const literal of corePalette) {
    assert.doesNotMatch(outsideTokens, new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), literal);
  }
});

test("the renderer keeps one stylesheet entry point", () => {
  const main = fs.readFileSync(path.join(root, "src", "renderer", "main.tsx"), "utf8");
  assert.equal((main.match(/\.\/styles\.css/g) || []).length, 1);
  assert.doesNotMatch(main, /\.css['"]\s*;[^\n]*\.css/);
});

test("shared primitive contracts are defined once in their primitive layer", () => {
  const primitives = extractLayer(stylesheet, "primitives");
  assert.match(primitives, /\.cw-panel\s*,\s*\.cw-card\s*\{/);
  assert.match(primitives, /\.cw-button\s*,\s*\.cw-icon-button\s*\{/);
  for (const selector of [".cw-input", ".cw-tabs", ".cw-tab", ".cw-status-badge", ".cw-scroll-area"]) {
    assert.equal((primitives.match(new RegExp(`\\${selector}\\s*\\{`, "g")) || []).length, 1, selector);
  }
});

test("remaining renderer inline styles are limited to the reviewed dynamic-style allowlist", () => {
  const rendererRoot = path.join(root, "src", "renderer");
  const allowed = new Set([
    "App.tsx",
    "LocalAiSetupPanel.tsx",
    "PerformanceDashboardView.tsx",
    "ReviewClipView.tsx",
    "TimestampedTranscriptPanel.tsx",
    "VideoPlayer.tsx",
  ]);
  const files = fs.readdirSync(rendererRoot).filter((file) => file.endsWith(".tsx"));
  const offenders = files.filter((file) => /\bstyle\s*=/.test(fs.readFileSync(path.join(rendererRoot, file), "utf8")));
  assert.deepEqual(offenders.sort(), [...allowed].sort());
});
