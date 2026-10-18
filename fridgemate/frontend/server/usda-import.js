import { createUsdaClient } from "./usda-client.js";
// Explicit CLI only. No catalog changes, no auto-selection, and no .env values printed.
try {
  const [command, ...args] = process.argv.slice(2),
    client = createUsdaClient();
  if (command === "search")
    console.log(JSON.stringify(await client.search(args.join(" ")), null, 2));
  else if (command === "detail" && /^\d+$/.test(args[0] ?? ""))
    console.log(JSON.stringify(await client.detail(Number(args[0])), null, 2));
  else
    throw new Error(
      "Use: node --env-file=backend/.env server/usda-import.js search <ingredient> | detail <reviewed-fdc-id>",
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
