// Pruebas del escáner con DNS/HTTP simulados: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDomain, scanDomain, type Report } from "../src/scan";

type Zone = Record<string, { type: number; data: string }[]>; // "nombre|TIPO" -> respuestas
interface Site { https?: { status: number; headers: Record<string, string> } | "fail"; httpLocation?: string; expiry?: string; certDays?: number; ad?: boolean }

function mockFetch(zone: Zone, site: Site) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.host === "cloudflare-dns.com") {
      const key = `${url.searchParams.get("name")}|${url.searchParams.get("type")}`;
      return Response.json({ Status: 0, AD: site.ad ?? false, Answer: zone[key] ?? [] });
    }
    if (url.host === "crt.sh") {
      if (site.certDays === undefined) return Response.json([]);
      const d = new Date(Date.now() + site.certDays * 86400000).toISOString().slice(0, 19);
      return Response.json([{ common_name: url.searchParams.get("q"), name_value: url.searchParams.get("q"), not_after: d }]);
    }
    if (url.host === "rdap.org") {
      return site.expiry ? Response.json({ events: [{ eventAction: "expiration", eventDate: site.expiry }] }) : new Response("", { status: 404 });
    }
    if (url.protocol === "https:") {
      if (!site.https || site.https === "fail") throw new TypeError("fetch failed");
      const r = new Response("ok", { status: site.https.status, headers: site.https.headers });
      Object.defineProperty(r, "url", { value: url.href });
      return r;
    }
    if (url.protocol === "http:") {
      return new Response("", { status: site.httpLocation ? 301 : 200, headers: site.httpLocation ? { location: site.httpLocation } : {} });
    }
    throw new Error("host inesperado " + url.host);
  }) as typeof fetch;
}

const byId = (r: Report, id: string) => r.checks.find((c) => c.id === id);
const TXT = 16, MX = 15;
const SAFE_HEADERS = {
  "strict-transport-security": "max-age=31536000", "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'", "referrer-policy": "no-referrer",
};

test("normalizeDomain limpia URLs, emails y rechaza IPs", () => {
  assert.equal(normalizeDomain("https://www.Panaderia-Pepe.es/contacto"), "panaderia-pepe.es");
  assert.equal(normalizeDomain("info@miempresa.com"), "miempresa.com");
  assert.equal(normalizeDomain("  miempresa.es "), "miempresa.es");
  assert.equal(normalizeDomain("192.168.1.1"), null);
  assert.equal(normalizeDomain("localhost"), null);
  assert.equal(normalizeDomain("intranet"), null);
  assert.equal(normalizeDomain(""), null);
});

test("pyme típica mal configurada: sin DMARC, SPF neutral, sin cabeceras", async () => {
  mockFetch({
    "panaderia.es|MX": [{ type: MX, data: "10 mx00.ionos.es." }],
    "panaderia.es|TXT": [{ type: TXT, data: '"v=spf1 include:_spf.perfora.net ?all"' }],
  }, { https: { status: 200, headers: { server: "Apache/2.4.29 (Ubuntu)", "x-powered-by": "PHP/7.2.24" } }, certDays: 5, expiry: new Date(Date.now() + 20 * 86400000).toISOString() });
  const r = await scanDomain("panaderia.es");
  assert.equal(r.provider, "IONOS");
  assert.equal(byId(r, "spf")?.level, "warn");
  assert.equal(byId(r, "dmarc")?.level, "bad");
  assert.equal(byId(r, "dkim")?.level, "warn");
  assert.equal(byId(r, "headers")?.level, "bad");
  assert.equal(byId(r, "version")?.level, "warn");
  assert.equal(byId(r, "cert")?.level, "bad");
  assert.equal(byId(r, "expiry")?.level, "warn");
  assert.equal(byId(r, "dnssec")?.level, "warn");
  assert.equal(byId(r, "redirect")?.level, "warn");
  assert.equal(r.grade, "bad");
  assert.ok(r.score < 5, `nota ${r.score}`);
});

test("dominio bien configurado saca nota alta", async () => {
  mockFetch({
    "bien.com|MX": [{ type: MX, data: "1 aspmx.l.google.com." }],
    "bien.com|TXT": [{ type: TXT, data: '"v=spf1 include:_spf.google.com -all"' }],
    "_dmarc.bien.com|TXT": [{ type: TXT, data: '"v=DMARC1; p=reject; rua=mailto:d@bien.com"' }],
    "google._domainkey.bien.com|TXT": [{ type: TXT, data: '"v=DKIM1; k=rsa; p=MIIBIjAN"' }],
  }, { https: { status: 200, headers: SAFE_HEADERS }, httpLocation: "https://bien.com/", certDays: 60, expiry: "2030-01-01T00:00:00Z", ad: true });
  const r = await scanDomain("bien.com");
  assert.equal(r.provider, "Google Workspace");
  for (const id of ["spf", "dmarc", "dkim", "https", "redirect", "headers", "cert", "dnssec", "expiry"]) {
    assert.equal(byId(r, id)?.level, "ok", id);
  }
  assert.equal(byId(r, "version"), undefined);
  assert.equal(r.score, 10);
  assert.equal(r.grade, "ok");
});

test("SPF peligrosos: +all, dos registros y DMARC solo observar", async () => {
  mockFetch({
    "a.es|MX": [{ type: MX, data: "0 a-es.mail.protection.outlook.com." }],
    "a.es|TXT": [{ type: TXT, data: '"v=spf1 +all"' }],
    "_dmarc.a.es|TXT": [{ type: TXT, data: '"v=DMARC1; p=none"' }],
  }, { https: "fail" });
  let r = await scanDomain("a.es");
  assert.equal(r.provider, "Microsoft 365");
  assert.equal(byId(r, "spf")?.level, "bad");
  assert.equal(byId(r, "dmarc")?.level, "warn");
  assert.match(byId(r, "dmarc")!.detail, /sin rua/);
  assert.equal(byId(r, "https")?.level, "bad");

  mockFetch({
    "b.es|MX": [{ type: MX, data: "10 mx.b.es." }],
    "b.es|TXT": [{ type: TXT, data: '"v=spf1 mx -all"' }, { type: TXT, data: '"v=spf1 include:x.com ~all"' }],
    "_dmarc.b.es|TXT": [{ type: TXT, data: '"v=DMARC1; p=quarantine; pct=20"' }],
  }, { https: "fail" });
  r = await scanDomain("b.es");
  assert.equal(byId(r, "spf")?.level, "bad");
  assert.match(byId(r, "spf")!.summary, /varios registros/);
  assert.equal(byId(r, "dmarc")?.level, "warn");
  assert.match(byId(r, "dmarc")!.summary, /20 %/);
});

test("dominio sin correo no penaliza DKIM", async () => {
  mockFetch({}, { https: { status: 200, headers: SAFE_HEADERS }, httpLocation: "https://web.es/" });
  const r = await scanDomain("web.es");
  assert.equal(byId(r, "mx")?.level, "info");
  assert.equal(byId(r, "dkim"), undefined);
  assert.match(byId(r, "mx")!.fix, /v=spf1 -all/);
});
