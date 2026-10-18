# Daywell app

See [the Daywell handoff](../DAYWELL.md) for startup, calendar connection, workflow, source limits and team handoff.

```sh
npm ci
npm run dev -- --host 127.0.0.1
npm test
npm run build
npm run lint
```

Open the Local URL printed by Vite and leave the server running. Apple Calendar uses the local Mac bridge; static hosting supports the frontend and ICS import only.
