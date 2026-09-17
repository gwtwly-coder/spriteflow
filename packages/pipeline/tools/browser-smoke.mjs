import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// Vite is an existing audited development dependency owned by apps/web.
import { createServer } from "../../../apps/web/node_modules/vite/dist/node/index.js";

const output = new URL("../.smoke-output/", import.meta.url);
mkdirSync(output, { recursive: true });
const profile = new URL(`profile-${Date.now()}/`, output);
mkdirSync(profile, { recursive: true });
const executable =
  process.env.SPRITEFLOW_BROWSER ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL("./browser-smoke/", import.meta.url)),
  cacheDir: fileURLToPath(new URL("vite-cache/", output)),
  server: {
    host: "127.0.0.1",
    port: 0,
    fs: { allow: [fileURLToPath(new URL("../", import.meta.url))] },
  },
  logLevel: "error",
});
await server.listen();
const child = spawn(
  executable,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${fileURLToPath(profile)}`,
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
let socket;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  const active = new URL("DevToolsActivePort", profile);
  for (let i = 0; i < 100 && !existsSync(active); i++) await sleep(100);
  if (!existsSync(active)) throw new Error("Browser debugging endpoint did not start");
  const port = readFileSync(active, "utf8").split(/\r?\n/)[0];
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (e) => {
    const reply = JSON.parse(e.data);
    if (reply.id) {
      pending.get(reply.id)?.(reply);
      pending.delete(reply.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const n = ++id;
      pending.set(n, resolve);
      socket.send(JSON.stringify({ id: n, method, params }));
    });
  const version = await send("Browser.getVersion");
  await send("Page.navigate", { url: server.resolvedUrls.local[0] });
  let result;
  for (let i = 0; i < 300; i++) {
    const response = await send("Runtime.evaluate", {
      expression: "globalThis.smokeResult",
      returnByValue: true,
    });
    result = response.result?.result?.value;
    if (result) break;
    await sleep(100);
  }
  const report = {
    browser: version.result?.product,
    version: version.result,
    userAgent: version.result?.userAgent,
    ...(result ?? { ok: false, error: "Smoke timed out" }),
  };
  writeFileSync(new URL("browser-report.json", output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  socket?.close();
  child.kill();
  await server.close();
}
