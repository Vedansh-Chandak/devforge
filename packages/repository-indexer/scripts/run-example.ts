import { scanRepository } from "../src/index.js";

async function main(): Promise<void> {
  const tree = await scanRepository("/tmp/df-pr2-fixture");
  console.log(JSON.stringify(tree, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exitCode = 1;
});
