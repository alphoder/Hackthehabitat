import { sql } from "../lib/db";

// Idempotent. `npx tsx scripts/migrate.ts`  (--reset drops everything first)
const statements = [
  `CREATE TABLE IF NOT EXISTS parks (
    id text PRIMARY KEY,
    name text NOT NULL,
    country text NOT NULL,
    center_lat double precision NOT NULL,
    center_lon double precision NOT NULL,
    radius_km double precision NOT NULL,
    polygon_geojson jsonb,
    zones_geojson jsonb,
    featured boolean NOT NULL DEFAULT false,
    meta jsonb
  )`,
  `CREATE TABLE IF NOT EXISTS fires (
    id serial PRIMARY KEY,
    park_id text REFERENCES parks(id),
    lat double precision NOT NULL,
    lon double precision NOT NULL,
    frp double precision NOT NULL DEFAULT 0,
    acq_date date NOT NULL,
    acq_time text NOT NULL,
    satellite text NOT NULL,
    daynight text,
    confidence text,
    source text NOT NULL DEFAULT 'VIIRS_SNPP_NRT',
    ingested_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (lat, lon, acq_date, acq_time, satellite)
  )`,
  `CREATE INDEX IF NOT EXISTS fires_park_date ON fires (park_id, acq_date DESC)`,
  `CREATE TABLE IF NOT EXISTS sensors (
    id text PRIMARY KEY,
    park_id text NOT NULL REFERENCES parks(id),
    kind text NOT NULL CHECK (kind IN ('camera','acoustic')),
    name text NOT NULL,
    lat double precision NOT NULL,
    lon double precision NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS media (
    id serial PRIMARY KEY,
    sensor_id text REFERENCES sensors(id),
    kind text NOT NULL CHECK (kind IN ('image','audio')),
    path text NOT NULL,
    captured_at timestamptz NOT NULL,
    sha256 text NOT NULL UNIQUE,
    truth_label text
  )`,
  `CREATE TABLE IF NOT EXISTS detections (
    id serial PRIMARY KEY,
    media_id integer NOT NULL REFERENCES media(id),
    label text NOT NULL,
    confidence double precision,
    model text NOT NULL,
    meta jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (media_id, model)
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    id serial PRIMARY KEY,
    park_id text NOT NULL REFERENCES parks(id),
    kind text NOT NULL,
    severity integer NOT NULL CHECK (severity BETWEEN 1 AND 5),
    lat double precision,
    lon double precision,
    occurred_at timestamptz NOT NULL,
    summary text NOT NULL,
    media_id integer REFERENCES media(id),
    meta jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS events_park_time ON events (park_id, occurred_at DESC)`,
  `CREATE TABLE IF NOT EXISTS briefings (
    id serial PRIMARY KEY,
    park_id text NOT NULL REFERENCES parks(id),
    content_md text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS incidents (
    id serial PRIMARY KEY,
    park_id text NOT NULL REFERENCES parks(id),
    title text NOT NULL,
    event_ids integer[] NOT NULL,
    dossier_html text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
];

async function main() {
  if (process.argv.includes("--reset")) {
    console.log("dropping tables…");
    await sql`DROP TABLE IF EXISTS incidents, briefings, events, detections, media, sensors, fires, parks CASCADE`;
  }
  for (const s of statements) await sql.query(s);
  const [{ now }] = (await sql`SELECT now()`) as { now: string }[];
  const tables = (await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' ORDER BY table_name`) as { table_name: string }[];
  console.log("connected:", now);
  console.log("tables:", tables.map((t) => t.table_name).join(", "));
}

main();
