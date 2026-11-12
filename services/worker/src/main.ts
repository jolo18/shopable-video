import http from "node:http";
import { createRunner } from "./runner";
import { buildHandlers } from "./handlers";
import { startScheduler } from "./scheduler";

const runner = createRunner({
  handlers: buildHandlers(),
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
});
const scheduler = startScheduler();

// Cloud Run services need a port to answer health checks.
const health = process.env.PORT
  ? http.createServer((_req, res) => res.end("ok")).listen(Number(process.env.PORT))
  : null;

console.log(JSON.stringify({ msg: "worker started" }));
void runner.start();

async function shutdown() {
  scheduler.stop();
  health?.close();
  await runner.stop();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
