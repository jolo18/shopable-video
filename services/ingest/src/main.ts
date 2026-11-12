import { createIngest } from "./server";

const port = Number(process.env.PORT ?? 8081);
const ingest = createIngest();

ingest.server.listen(port, () => {
  console.log(JSON.stringify({ msg: "ingest listening", port }));
});

async function shutdown() {
  await ingest.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
