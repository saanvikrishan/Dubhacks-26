import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, stat, copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = path.join(root, ".calendar-bridge/DaywellCalendar.app");
const binary = path.join(bundle, "Contents/MacOS/DaywellCalendar");
let compiling;
export async function ensureCalendarBridge() {
  if (process.platform !== "darwin")
    throw new Error(
      "Apple Calendar connection is available on a Mac running the local WhatsCooking server. Import .ics on other systems.",
    );
  if (!compiling)
    compiling = (async () => {
      const source = path.join(root, "native/CalendarBridge.swift"),
        info = path.join(root, "native/Info.plist");
      const modified = Math.max(
        (await stat(source)).mtimeMs,
        (await stat(info)).mtimeMs,
      );
      if (
        await stat(binary)
          .then((s) => s.mtimeMs >= modified)
          .catch(() => false)
      )
        return;
      await mkdir(path.dirname(binary), { recursive: true });
      await copyFile(info,path.join(bundle,"Contents/Info.plist"));
      await exec(
        "/usr/bin/xcrun",
        [
          "swiftc",
          "-parse-as-library",
          source,
          "-o",
          binary,
          "-Xlinker",
          "-sectcreate",
          "-Xlinker",
          "__TEXT",
          "-Xlinker",
          "__info_plist",
          "-Xlinker",
          info,
        ],
        {
          timeout: 60000,
          env: {
            ...process.env,
            CLANG_MODULE_CACHE_PATH: path.join(root, ".calendar-bridge/cache"),
          },
        },
      );
      await exec(
        "/usr/bin/codesign",
        [
          "--force",
          "--sign",
          "-",
          "--identifier",
          "local.daywell.calendar-reader",
          bundle,
        ],
        { timeout: 10000 },
      );
    })().catch((error) => {
      compiling = null;
      throw error;
    });
  return compiling;
}
export async function readAppleCalendar(command, from, to) {
  await ensureCalendarBridge();
  const args =
    command === "events"
      ? ["--events", from, to]
      : [command === "connect" ? "--connect" : "--status"];
  const temporary=await mkdtemp(path.join(tmpdir(),"daywell-calendar-"));
  const output=path.join(temporary,"result.json");
  try {
    // Launch Services gives the permission prompt the native app's identity and run loop.
    await exec("/usr/bin/open",["-n","-W",bundle,"--args",...args,"--output",output],{
      timeout:command==="connect"?90000:20000,
      maxBuffer:4*1024*1024,
    });
    return JSON.parse(await readFile(output,"utf8"));
  } finally { await rm(temporary,{recursive:true,force:true}); }
}
export function calendarApi() {
  return {
    name: "daywell-local-calendar",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/calendar/")) return next();
        const url = new URL(req.url, "http://127.0.0.1");
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        const fail = (message, status = 400) => {
          res.statusCode = status;
          res.end(JSON.stringify({ error: message }));
        };
        // Loopback-only, same-origin bridge. No CORS, remote URLs, writes, or polling.
        const host = req.headers.host || "",
          origin = req.headers.origin;
        if (
          !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
            req.socket?.remoteAddress,
          ) ||
          !/^(127\.0\.0\.1|localhost):\d+$/.test(host) ||
          (origin && ![`http://${host}`].includes(origin)) ||
          req.headers["sec-fetch-site"] === "cross-site"
        )
          return fail(
            "Calendar access is limited to this local Daywell origin.",
            403,
          );
        const command = url.pathname.split("/").pop();
        if (!["status", "connect", "events"].includes(command))
          return fail("Unknown calendar operation.", 404);
        if (command === "connect" && req.method !== "POST")
          return fail(
            "Use the Connect button to request calendar permission.",
            405,
          );
        if (command !== "connect" && req.method !== "GET")
          return fail("Unsupported method.", 405);
        const from = url.searchParams.get("from"),
          to = url.searchParams.get("to");
        if (
          command === "events" &&
          (!Number.isFinite(Date.parse(from)) ||
            !Number.isFinite(Date.parse(to)) ||
            Date.parse(to) <= Date.parse(from) ||
            Date.parse(to) - Date.parse(from) > 93 * 86400000)
        )
          return fail("Choose a calendar range of 93 days or fewer.");
        try {
          const result = await readAppleCalendar(command, from, to);
          if (result.error)
            res.statusCode = result.authorized === false ? 403 : 400;
          res.end(JSON.stringify(result));
        } catch (error) {
          fail(
            error.message.includes("Apple Calendar")
              ? error.message
              : "The local Apple Calendar bridge is unavailable. Import an .ics export or retry the local connection.",
            503,
          );
        }
      });
    },
  };
}
