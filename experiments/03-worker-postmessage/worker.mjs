import { Worker, isMainThread, parentPort } from "node:worker_threads";

if (isMainThread) {
  const worker = new Worker(new URL(import.meta.url));
  worker.postMessage("hola");
  setTimeout(() => process.exit(0), 500);
} else {
  console.log("typeof globalThis.postMessage:", typeof globalThis.postMessage);
  parentPort.on("message", (m) => console.log("parentPort recibió:", m));
  globalThis.onmessage = (e) => console.log("onmessage recibió:", e.data);
}
