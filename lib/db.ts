import { neon } from "@neondatabase/serverless";
import dns from "node:dns";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");

// ponytail: local-dev DNS shim. Neon resumes suspended endpoints through
// `api.<region>.aws.neon.tech`; this machine's router resolver returns NXDOMAIN for it
// while public resolvers answer fine. fetch() resolves via dns.lookup (the OS resolver),
// which dns.setServers does NOT affect - so route lookups through a Resolver we control,
// falling back to the OS on any failure. Vercel's resolver is healthy, so skip it there.
// Permanent fix: set this Mac's DNS to 8.8.8.8 and delete this block.
if (!process.env.VERCEL && !(globalThis as { __dnsPatched?: boolean }).__dnsPatched) {
  (globalThis as { __dnsPatched?: boolean }).__dnsPatched = true;
  // Fast path FIRST: the OS resolver answers almost every host correctly and instantly.
  // Only hosts it genuinely cannot resolve fall through to a public resolver, and the answer
  // is cached so a given host pays that cost at most once.
  //
  // Ordering matters enormously here. Querying 8.8.8.8 first made EVERY lookup wait for UDP
  // packets this network drops - ~18s per lookup, which showed up as 20-second page loads.
  const resolver = new dns.promises.Resolver({ timeout: 1500, tries: 1 });
  resolver.setServers(["8.8.8.8", "1.1.1.1"]);
  const osLookup = dns.lookup;
  const fallbackCache = new Map<string, string[]>();

  type Cb = (err: NodeJS.ErrnoException | null, addr?: string | { address: string; family: number }[], family?: number) => void;
  const patched = (hostname: string, options: unknown, cb?: Cb) => {
    const done = (typeof options === "function" ? options : cb) as Cb;
    const opts = (typeof options === "function" ? {} : options ?? {}) as { all?: boolean };
    const reply = (addrs: string[]) =>
      done(null, opts.all ? addrs.map((address) => ({ address, family: 4 })) : addrs[0], 4);

    const cached = fallbackCache.get(hostname);
    if (cached) return reply(cached);

    osLookup(hostname, opts as dns.LookupOptions, ((err: NodeJS.ErrnoException | null, ...rest: unknown[]) => {
      if (!err) return (done as (...a: unknown[]) => void)(err, ...rest);
      resolver.resolve4(hostname).then(
        (addrs) => {
          if (!addrs.length) return done(err);
          fallbackCache.set(hostname, addrs);
          reply(addrs);
        },
        () => done(err)
      );
    }) as never);
  };
  (dns as { lookup: unknown }).lookup = patched;
}

export const sql = neon(process.env.DATABASE_URL);

export type Park = {
  id: string;
  name: string;
  country: string;
  center_lat: number;
  center_lon: number;
  radius_km: number;
  polygon_geojson: unknown | null;
  zones_geojson: unknown | null;
  featured: boolean;
  meta: Record<string, unknown> | null;
};

export type Fire = {
  id: number;
  park_id: string | null;
  lat: number;
  lon: number;
  frp: number;
  acq_date: string;
  acq_time: string;
  satellite: string;
  daynight: string;
};

export type EventRow = {
  id: number;
  park_id: string;
  kind: string;
  severity: number;
  lat: number | null;
  lon: number | null;
  occurred_at: string;
  summary: string;
  media_id: number | null;
  meta: Record<string, unknown> | null;
};
