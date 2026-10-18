import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { Spectrum, text } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";

const USER_ID = "demo";
const POLL_MS = 30_000;
const LEAD_MS = 15 * 60 * 1000;
let spectrumApp;
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../backend/.env");

loadEnv(envPath);

const databaseUrl = (process.env.DATABASE_URL || "").trim();
if (!databaseUrl) {
  console.log("DATABASE_URL is missing. Set it in backend/.env.");
  process.exit(0);
}

const pool = new pg.Pool(poolConfig(databaseUrl));

const [command, ...args] = process.argv.slice(2);

try {
  if (command === "drop-tables") {
    await dropTables();
    console.log("Dropped photon_contacts, photon_plans, and photon_sent.");
  } else if (command === "phone") {
    await ensureTables();
    await savePhone(args[0]);
  } else if (command === "plan") {
    await ensureTables();
    await savePlan(args);
  } else if (!command) {
    requireSpectrum();
    await ensureTables();
    console.log("Photon reminders polling every 30 seconds.");
    await tick();
    const timer = setInterval(() => {
      tick().catch((error) => console.error("Poll failed:", error.message));
    }, POLL_MS);
    const stop = async () => {
      clearInterval(timer);
      await pool.end();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } else {
    usage();
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (command || process.exitCode) await pool.end();
}

function loadEnv(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function poolConfig(url) {
  if (/localhost|127\.0\.0\.1/.test(url) || /sslmode=disable/.test(url)) {
    return { connectionString: url };
  }
  const connectionString = url
    .replace(/([?&])sslmode=[^&]*/g, "$1")
    .replace(/([?&])uselibpqcompat=[^&]*/g, "$1")
    .replace(/\?&/g, "?")
    .replace(/[?&]$/, "");
  return { connectionString, ssl: { rejectUnauthorized: false } };
}

function requireSpectrum() {
  if (!process.env.SPECTRUM_PROJECT_ID || !process.env.SPECTRUM_PROJECT_SECRET) {
    throw new Error(
      "SPECTRUM_PROJECT_ID and SPECTRUM_PROJECT_SECRET are missing from backend/.env.",
    );
  }
}

function usage() {
  console.log(`Usage:
  node remind.mjs
  node remind.mjs phone +15551234567
  node remind.mjs plan --name "Tofu bowl" --date YYYY-MM-DD --time HH:MM [--meal-id id]
  node remind.mjs drop-tables`);
}

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS photon_contacts (
      id serial PRIMARY KEY,
      user_id text NOT NULL DEFAULT 'demo',
      phone text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS photon_plans (
      id serial PRIMARY KEY,
      user_id text NOT NULL DEFAULT 'demo',
      meal_name text NOT NULL,
      meal_date text NOT NULL,
      meal_time text NOT NULL,
      meal_id text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS photon_sent (
      id serial PRIMARY KEY,
      user_id text NOT NULL,
      meal_date text NOT NULL,
      meal_time text NOT NULL,
      meal_name text NOT NULL,
      sent_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, meal_date, meal_time, meal_name)
    )
  `);
}

async function dropTables() {
  await pool.query("DROP TABLE IF EXISTS photon_sent");
  await pool.query("DROP TABLE IF EXISTS photon_plans");
  await pool.query("DROP TABLE IF EXISTS photon_contacts");
}

async function savePhone(phone) {
  if (!/^\+[1-9]\d{7,14}$/.test(phone || "")) {
    throw new Error("Pass a phone number in E.164 form, like +15551234567.");
  }
  await pool.query(
    `INSERT INTO photon_contacts (user_id, phone)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET phone = EXCLUDED.phone`,
    [USER_ID, phone],
  );
  console.log(`Saved phone for ${USER_ID}.`);
}

async function savePlan(argv) {
  const flags = flagsFrom(argv);
  const mealDate = flags.date;
  const mealTime = flags.time;
  const mealId = flags["meal-id"] || null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mealDate || "")) {
    throw new Error("Pass --date as YYYY-MM-DD.");
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(mealTime || "")) {
    throw new Error("Pass --time as HH:MM.");
  }
  let name = flags.name || "";
  if (!name && mealId) {
    const found = await pool.query(
      `SELECT name FROM saved_meals
       WHERE user_id = $1 AND meal_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [USER_ID, mealId],
    );
    name = found.rows[0]?.name || "";
  }
  if (!name) throw new Error('Pass --name, or a --meal-id that exists in saved_meals.');
  await pool.query(
    `INSERT INTO photon_plans (user_id, meal_name, meal_date, meal_time, meal_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [USER_ID, name, mealDate, mealTime, mealId],
  );
  console.log(`Saved plan ${name} at ${mealTime} on ${mealDate}.`);
}

function flagsFrom(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}.`);
    flags[key] = value;
    i += 1;
  }
  return flags;
}

async function sendReminder(phone, message) {
  try {
    if (!spectrumApp) {
      spectrumApp = await Spectrum({
        projectId: process.env.SPECTRUM_PROJECT_ID,
        projectSecret: process.env.SPECTRUM_PROJECT_SECRET,
        providers: [imessage.config()],
      });
    }
    const im = imessage(spectrumApp);
    console.log("sendReminder to:", JSON.stringify(phone));
    const dm = await im.space.create(phone);
    console.log("sendReminder chat:", JSON.stringify(dm.id));
    await dm.send(text(message));
  } catch (error) {
    console.error("sendReminder message:", error.message);
    console.error("sendReminder cause:", error.cause);
    console.log(JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    throw error;
  }
}

async function tick() {
  const due = await pool.query(
    `SELECT p.user_id, p.meal_name, p.meal_date, p.meal_time
     FROM photon_plans p
     WHERE NOT EXISTS (
       SELECT 1 FROM photon_sent s
       WHERE s.user_id = p.user_id
         AND s.meal_date = p.meal_date
         AND s.meal_time = p.meal_time
         AND s.meal_name = p.meal_name
     )`,
  );
  const now = Date.now();
  for (const row of due.rows) {
    const when = slotTime(row.meal_date, row.meal_time);
    if (when < now || when > now + LEAD_MS) continue;
    const contact = await pool.query(
      "SELECT phone FROM photon_contacts WHERE user_id = $1",
      [row.user_id],
    );
    const phone = contact.rows[0]?.phone;
    if (!phone) {
      console.error(`No phone for ${row.user_id}; skipped ${row.meal_name}.`);
      continue;
    }
    const text = `Reminder: ${row.meal_name} is at ${row.meal_time} on ${row.meal_date}.`;
    try {
      await sendReminder(phone, text);
      await pool.query(
        `INSERT INTO photon_sent (user_id, meal_date, meal_time, meal_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, meal_date, meal_time, meal_name) DO NOTHING`,
        [row.user_id, row.meal_date, row.meal_time, row.meal_name],
      );
      console.log(`Sent reminder for ${row.meal_name}.`);
    } catch (error) {
      console.error(`Reminder send failed for ${row.meal_name}:`, error.stack || error.message);
    }
  }
}

function slotTime(date, time) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}
