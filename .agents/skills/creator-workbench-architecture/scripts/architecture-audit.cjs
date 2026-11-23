#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const [mode = "inspect", rootArg = process.cwd()] = process.argv.slice(2);
if (!["inspect", "snapshot", "check"].includes(mode)) throw new Error("Use inspect, snapshot or check, followed by the repository path.");
const root = path.resolve(rootArg);
const absolute = relative => path.join(root, relative);
if (!fs.existsSync(absolute("src/electron/main.ts"))) throw new Error("Not a Creator Workbench checkout.");
const ts = createRequire(absolute("package.json"))("typescript");
const read = relative => fs.readFileSync(absolute(relative), "utf8");
const parse = relative => ts.createSourceFile(relative, read(relative), ts.ScriptTarget.Latest, true);
const walk = (node, visit) => { visit(node); ts.forEachChild(node, child => walk(child, visit)); };
const strings = node => ts.isStringLiteral(node) ? node.text : null;
function filesUnder(relative) {
  return fs.readdirSync(absolute(relative), { withFileTypes: true }).flatMap(entry => {
    const next = relative + "/" + entry.name;
    return entry.isDirectory() ? filesUnder(next) : /\.(?:tsx?|css)$/.test(next) ? [next] : [];
  }).sort();
}
const sourceFiles = filesUnder("src");
const catalogue = [];
walk(parse("src/shared/appActions.ts"), node => {
  if (ts.isPropertyAssignment(node) && node.name.getText() === "id" && strings(node.initializer)) catalogue.push(node.initializer.text);
});
const registrations = [];
for (const file of sourceFiles.filter(file => file.startsWith("src/electron/actions/"))) {
  walk(parse(file), node => {
    if (ts.isCallExpression(node) && node.expression.getText() === "registerAppActionHandler" && strings(node.arguments[0])) registrations.push(node.arguments[0].text);
  });
}
const errors = [];
for (const id of catalogue) if (registrations.filter(value => value === id).length !== 1) errors.push("Expected exactly one handler: " + id);
for (const id of registrations) if (!catalogue.includes(id)) errors.push("Uncatalogued handler: " + id);
if (new Set(catalogue).size !== catalogue.length) errors.push("Duplicate catalogue IDs.");
const collections = [];
walk(parse("src/electron/services/database.ts"), node => {
  if (ts.isInterfaceDeclaration(node) && node.name.text === "CreatorWorkspaceStore") {
    for (const member of node.members) collections.push({ name: member.name.getText(), type: member.type.getText() });
  }
});
const controllers = sourceFiles.filter(file => file.startsWith("src/renderer/") && /\/use[^/]+\.tsx?$/.test(file));
const aiCallers = sourceFiles.filter(file => file.startsWith("src/electron/services/") && /from ["']\.\/aiExecutionService["']/.test(read(file)));
const overview = "docs/architecture/creator-workbench-architecture.md";
const entity = "docs/architecture/creator-workspace-data-flow-and-erd.md";
const snapshotPath = absolute("docs/architecture/architecture-source-snapshot.json");
if (mode !== "inspect") {
  const document = read(overview);
  const references = [...document.matchAll(/\| `(src\/[^\`]+)` \| `([^\`]+)` \|/g)];
  if (!references.length) errors.push("Overview needs source evidence table rows.");
  for (const [, file, symbol] of references) {
    if (!sourceFiles.includes(file)) errors.push("Missing evidence file: " + file);
    else if (!read(file).includes(symbol)) errors.push("Missing evidence symbol: " + file + "#" + symbol);
  }
  const diagrams = [...document.matchAll(/```mermaid\s*\n([\s\S]*?)```/g)];
  if (!diagrams.length) errors.push("Overview needs a Mermaid diagram.");
  for (const [, body] of diagrams) if (!/^\s*(flowchart|erDiagram)\b/.test(body)) errors.push("Unsupported diagram header.");
}
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
const inventory = { sourceFileCount: sourceFiles.length, actionCount: catalogue.length, registeredHandlers: registrations.length, controllers, collections, aiCallers };
if (mode === "inspect") { console.log(JSON.stringify(inventory, null, 2)); process.exit(0); }
const watched = [...sourceFiles, "package.json", "tsconfig.json", "tsconfig.electron.json", overview, entity].sort();
const hashes = Object.fromEntries(watched.map(file => [file, crypto.createHash("sha256").update(fs.readFileSync(absolute(file), "utf8").replace(/\r\n/g, "\n")).digest("hex")]));
if (mode === "snapshot") {
  const snapshot = { version: 2, verifiedAt: new Date().toISOString(), note: "Source/reference checks; not semantic or live acceptance.", inventory, hashes };
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n");
  console.log("Recorded " + watched.length + " source/configuration/reference hashes; " + catalogue.length + " actions.");
} else {
  const previous = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  if (previous.version !== 2) throw new Error("Reinspect and record a snapshot using LF-normalized text hashes.");
  const changed = [...new Set([...Object.keys(previous.hashes), ...Object.keys(hashes)])].filter(file => previous.hashes[file] !== hashes[file]);
  if (changed.length) { console.error("Architecture reinspection required:\n" + changed.join("\n")); process.exit(1); }
  console.log("Architecture snapshot current; source evidence and all " + catalogue.length + " action registrations verified.");
}
