import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const doc = readFileSync(new URL("../../docs/interface-contract.md", root), "utf8");
const blocks = [...doc.matchAll(/```ts\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
const browser = blocks.find((b) => b.includes("createPipelineClient("));
const core = blocks.filter((b) => b !== browser).join("\n");
const usage = doc.match(/```ts usage\r?\n([\s\S]*?)```/)[1];
const readme = readFileSync(new URL("README.md", root), "utf8");
const readmeExamples = [...readme.matchAll(/```ts\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
const virtualRoot = fileURLToPath(new URL("tests/fixtures/", root)).replaceAll("\\", "/");
const files = new Map([
  [`${virtualRoot}expected.ts`, core],
  [
    `${virtualRoot}browser-expected.ts`,
    `import type { InitOptions, PipelineClient, PipelineWorkerApi } from "./expected.js";\n${browser}`,
  ],
  [
    `${virtualRoot}compare.ts`,
    `import * as actual from "../../src/index.js";
import * as expected from "./expected.js";
const a: typeof expected = actual;
const b: typeof actual = expected;
void a; void b;`,
  ],
  [
    `${virtualRoot}browser-compare.ts`,
    `import * as actual from "../../src/browser/index.js";
import * as expected from "./browser-expected.js";
const a: typeof expected = actual;
const b: typeof actual = expected;
void a; void b;`,
  ],
  [`${virtualRoot}usage.ts`, `declare const file: File;\n${usage}`],
]);
for (const [i, example] of readmeExamples.entries())
  files.set(`${virtualRoot}readme-${i}.ts`, example);
function run(dom) {
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    noEmit: true,
    types: [],
    lib: dom ? ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"] : ["lib.es2022.d.ts"],
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options),
    read = host.readFile.bind(host),
    exists = host.fileExists.bind(host),
    dirs = host.directoryExists.bind(host);
  host.readFile = (name) => files.get(name.replaceAll("\\", "/")) ?? read(name);
  host.fileExists = (name) => files.has(name.replaceAll("\\", "/")) || exists(name);
  host.directoryExists = (name) =>
    name.replaceAll("\\", "/").startsWith(virtualRoot.replace(/\/$/, "")) || dirs(name);
  host.getSourceFile = (name, language) => {
    const source = host.readFile(name);
    return source === undefined ? undefined : ts.createSourceFile(name, source, language, true);
  };
  const program = ts.createProgram(
    dom ? [...files.keys()] : [`${virtualRoot}compare.ts`, `${virtualRoot}readme-0.ts`],
    options,
    host,
  );
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length)
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCurrentDirectory: () => process.cwd(),
        getCanonicalFileName: (f) => f,
        getNewLine: () => "\n",
      }),
    );
  const checker = program.getTypeChecker();
  const actual = program.getSourceFile(fileURLToPath(new URL("src/index.ts", root)));
  const expected = program.getSourceFile(`${virtualRoot}expected.ts`);
  const names = (source) =>
    checker
      .getExportsOfModule(checker.getSymbolAtLocation(source))
      .map((s) => s.name)
      .sort();
  assert.deepEqual(
    names(actual),
    names(expected),
    "Public export names must exactly match the contract",
  );
}
run(false);
run(true);
console.log(
  "Contract PASS: exact root exports, bidirectional API types, ES2022 without DOM, browser types, contract usage and README examples.",
);
