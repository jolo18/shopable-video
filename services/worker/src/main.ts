import { createRunner } from "./runner";
import { buildHandlers } from "./handlers";
import { startScheduler } from "./scheduler";

const runner = createRunner({
  handlers: buildHandlers(),
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
});
const scheduler = startScheduler();

console.log(JSON.stringify({ msg: "worker started" }));
void runner.start();

async function shutdown() {
  scheduler.stop();
  await runner.stop();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
