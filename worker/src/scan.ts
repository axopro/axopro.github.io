// Escáner pasivo de dominios: solo consulta información pública (DNS, HTTPS, CT, RDAP).
// No escanea puertos ni prueba credenciales.

export type Level = "ok" | "warn" | "bad" | "info";
export interface Check {
  id: string;
  area: "correo" | "web" | "dominio";
  title: string;
  level: Level;
  summary: string; // frase para el dueño del negocio
  detail: string; // dato técnico para el técnico
  fix: string; // cómo arreglarlo
  weight: number; // importancia en la nota
}

const DOH = "https://cloudflare-dns.com/dns-query";
const UA = "EscanerSeguridad/1.0 (+https://axopro.github.io/escaner/)";

interface DohAnswer { name: string; type: number; data: string }
interface DohResponse { Status: number; AD?: boolean; Answer?: DohAnswer[] }

async function withTimeout<T>(p: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await p(ctrl.signal); } finally { clearTimeout(t); }
}

async function dns(name: string, type: string): Promise<DohResponse> {
  return withTimeout(async (signal) => {
    const r = await fetch(`${DOH}?name=${encodeURIComponent(name)}&type=${type}&do=1`, {
      headers: { accept: "application/dns-json" }, signal,
    });
    if (!r.ok) throw new Error(`DoH ${r.status}`);
    return (await r.json()) as DohResponse;
  }, 5000);
}

async function txt(name: string): Promise<string[]> {
  const r = await dns(name, "TXT");
  return (r.Answer ?? []).filter((a) => a.type === 16).map((a) => a.data.replace(/^"|"$/g, "").replace(/"\s*"/g, ""));
}

/** Normaliza lo que escriba el usuario a un dominio válido, o null. */
export function normalizeDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (s.includes("@")) s = s.split("@").pop()!; // admite un email
  try {
    const host = new URL(s.includes("://") ? s : `http://${s}`).hostname.replace(/^www\./, "");
    if (host.length > 253 || !host.includes(".")) return null;
    if (/^[\d.]+$/.test(host) || host.includes(":")) return null; // nada de IPs
    if (!/^[a-z0-9.-]+$/.test(host) || host.endsWith(".local") || host === "localhost") return null;
    return host;
  } catch {
    return null;
  }
}

// ---------- Correo ----------

async function checkMx(domain: string): Promise<{ check: Check; provider: string | null; hasMx: boolean }> {
  const r = await dns(domain, "MX");
  const mx = (r.Answer ?? []).filter((a) => a.type === 15).map((a) => a.data.split(" ").pop()!.replace(/\.$/, ""));
  let provider: string | null = null;
  const all = mx.join(" ");
  if (/google\.com|googlemail\.com/.test(all)) provider = "Google Workspace";
  else if (/outlook\.com|protection\.outlook/.test(all)) provider = "Microsoft 365";
  else if (/zoho/.test(all)) provider = "Zoho";
  else if (/ionos|1and1/.test(all)) provider = "IONOS";
  else if (/hostinger/.test(all)) provider = "Hostinger";
  else if (/ovh/.test(all)) provider = "OVH";
  if (mx.length === 0) {
    return {
      hasMx: false, provider,
      check: { id: "mx", area: "correo", title: "Servidor de correo", level: "info", weight: 0,
        summary: "Este dominio no recibe correo.",
        detail: "Sin registros MX.",
        fix: "Si no usáis correo con este dominio, publicad SPF «v=spf1 -all» y DMARC «p=reject» para que nadie lo use para suplantaros." },
    };
  }
  return {
    hasMx: true, provider,
    check: { id: "mx", area: "correo", title: "Servidor de correo", level: "info", weight: 0,
      summary: provider ? `El correo está alojado en ${provider}.` : "El dominio recibe correo.",
      detail: `MX: ${mx.join(", ")}`, fix: "" },
  };
}

async function checkSpf(domain: string): Promise<Check> {
  const base = { id: "spf", area: "correo" as const, title: "SPF (quién puede enviar en tu nombre)", weight: 2 };
  const recs = (await txt(domain)).filter((t) => /^v=spf1\b/i.test(t));
  if (recs.length === 0) return { ...base, level: "bad",
    summary: "No hay ninguna lista de servidores autorizados: cualquiera puede enviar correos como si fuerais vosotros.",
    detail: "No existe registro TXT v=spf1.",
    fix: "Crear un registro TXT en el dominio con los servidores que envían vuestro correo, terminando en «-all» (p. ej. Google: «v=spf1 include:_spf.google.com -all»)." };
  if (recs.length > 1) return { ...base, level: "bad",
    summary: "Hay varios registros SPF a la vez y eso lo invalida: los proveedores de correo lo tratan como si no existiera.",
    detail: recs.join(" | "), fix: "Unificar todo en un único registro v=spf1." };
  const spf = recs[0];
  const lookups = (spf.match(/\b(include|a|mx|ptr|exists|redirect)[:=]?/gi) ?? []).length;
  if (/[+]all\b|\sall\b/i.test(spf) && !/[-~?]all\b/i.test(spf)) return { ...base, level: "bad",
    summary: "El SPF autoriza a TODO el mundo a enviar correos en vuestro nombre.", detail: spf,
    fix: "Cambiar «+all» por «-all»." };
  if (/\?all\b/i.test(spf)) return { ...base, level: "warn",
    summary: "El SPF existe pero es neutral: no protege frente a correos falsos.", detail: spf,
    fix: "Cambiar «?all» por «-all» (o «~all» mientras se revisa)." };
  if (lookups > 10) return { ...base, level: "warn",
    summary: "El SPF es demasiado largo y algunos proveedores lo ignoran.", detail: `${spf} (≈${lookups} consultas DNS; máx. 10)`,
    fix: "Reducir los «include» o aplanar el registro." };
  if (/~all\b/i.test(spf)) return { ...base, level: "ok",
    summary: "Hay lista de servidores autorizados (modo permisivo).", detail: spf,
    fix: "Cuando DMARC esté en «reject», se puede endurecer a «-all»." };
  return { ...base, level: "ok", summary: "Hay lista de servidores autorizados y es estricta.", detail: spf, fix: "" };
}

async function checkDmarc(domain: string): Promise<Check> {
  const base = { id: "dmarc", area: "correo" as const, title: "DMARC (bloqueo de correos falsos)", weight: 3 };
  const rec = (await txt(`_dmarc.${domain}`)).find((t) => /^v=DMARC1\b/i.test(t));
  if (!rec) return { ...base, level: "bad",
    summary: "Nadie bloquea los correos falsos con vuestra dirección. Es la puerta del fraude de facturas y del «fraude del CEO».",
    detail: `No existe registro TXT en _dmarc.${domain}.`,
    fix: `Crear TXT en _dmarc.${domain}: «v=DMARC1; p=none; rua=mailto:dmarc@${domain}», revisar informes 2-4 semanas y subir a «p=quarantine» y luego «p=reject».` };
  const p = /\bp=(\w+)/i.exec(rec)?.[1]?.toLowerCase();
  const pct = Number(/\bpct=(\d+)/i.exec(rec)?.[1] ?? 100);
  const rua = /\brua=/i.test(rec);
  if (p === "reject" || p === "quarantine") {
    if (pct < 100) return { ...base, level: "warn",
      summary: `Los correos falsos se bloquean, pero solo el ${pct} %.`, detail: rec, fix: "Subir pct a 100." };
    return { ...base, level: "ok",
      summary: p === "reject" ? "Los correos falsos con vuestra dirección se rechazan." : "Los correos falsos con vuestra dirección van a spam.",
      detail: rec, fix: p === "quarantine" ? "Cuando no haya incidencias, subir a «p=reject»." : "" };
  }
  return { ...base, level: "warn",
    summary: "DMARC está en modo «solo observar»: los correos falsos siguen llegando a la bandeja de entrada.",
    detail: rec + (rua ? "" : " (sin rua: nadie recibe los informes)"),
    fix: `Revisar los informes${rua ? "" : " (añadir rua=mailto:...)"} y pasar a «p=quarantine» y después «p=reject».` };
}

const DKIM_SELECTORS = ["google", "selector1", "selector2", "default", "k1", "k2", "s1", "s2", "dkim", "mail", "zoho", "zmail", "mxvault", "smtp", "ionos", "hostinger", "protonmail", "fm1", "sig1", "everlytickey1", "mandrill", "sendgrid", "brevo", "mailjet"];

async function checkDkim(domain: string, provider: string | null): Promise<Check> {
  const base = { id: "dkim", area: "correo" as const, title: "DKIM (firma de los correos)", weight: 1 };
  // Una clave DKIM real: "p=" seguido de una clave en base64 (no vale cualquier TXT).
  const isKey = (t: string) => /(^|;)\s*p=[A-Za-z0-9+/]{40,}/.test(t.replace(/"\s*"/g, "").replace(/"/g, ""));
  // Control: un selector inventado. Si responde, el dominio tiene DNS comodín y
  // esas respuestas no cuentan como DKIM.
  const control = `x${Math.random().toString(36).slice(2, 10)}._domainkey.${domain}`;
  const [ctrlTxt, ctrlCname] = await Promise.all([dns(control, "TXT").catch(() => null), dns(control, "CNAME").catch(() => null)]);
  const wildTxt = new Set((ctrlTxt?.Answer ?? []).filter((a) => a.type === 16).map((a) => a.data));
  const wildCname = new Set((ctrlCname?.Answer ?? []).filter((a) => a.type === 5).map((a) => a.data));
  const found: string[] = [];
  await Promise.all(DKIM_SELECTORS.map(async (s) => {
    try {
      const name = `${s}._domainkey.${domain}`;
      const r = await dns(name, "TXT");
      if ((r.Answer ?? []).some((a) => a.type === 16 && !wildTxt.has(a.data) && isKey(a.data))) { found.push(s); return; }
      // Proveedores que delegan por CNAME (Microsoft 365, SendGrid, Mailchimp...)
      const c = await dns(name, "CNAME");
      if ((c.Answer ?? []).some((a) => a.type === 5 && !wildCname.has(a.data) && /domainkey|dkim/i.test(a.data))) found.push(s);
    } catch { /* selector no responde */ }
  }));
  found.sort();
  if (found.length) return { ...base, level: "ok", summary: "Los correos salen firmados digitalmente.",
    detail: `Selectores encontrados: ${found.join(", ")}`, fix: "" };
  return { ...base, level: "warn",
    summary: "No encontramos firma digital de los correos: es más fácil que acaben en spam.",
    detail: `Ningún selector común responde (${DKIM_SELECTORS.length} probados). Puede existir con un selector propio.`,
    fix: provider ? `Activar DKIM en el panel de ${provider} y publicar el registro que indique.` : "Activar DKIM en el proveedor de correo y publicar su registro." };
}

// ---------- Web ----------

async function checkWeb(domain: string): Promise<Check[]> {
  const out: Check[] = [];
  let res: Response | null = null;
  let error = "";
  for (const host of [domain, `www.${domain}`]) {
    try {
      res = await withTimeout((signal) => fetch(`https://${host}/`, { redirect: "follow", headers: { "user-agent": UA }, signal }), 8000);
      break;
    } catch (e) { error = (e as Error).message; }
  }
  if (!res) {
    out.push({ id: "https", area: "web", title: "Web segura (HTTPS)", level: "bad", weight: 2,
      summary: "La web no abre de forma segura: el navegador muestra «No seguro» o no carga.",
      detail: `Fallo al conectar por HTTPS: ${error || "sin respuesta"}`,
      fix: "Instalar un certificado (Let's Encrypt es gratis) y comprobar que la web responde por https://." });
    return out;
  }
  out.push({ id: "https", area: "web", title: "Web segura (HTTPS)", level: "ok", weight: 2,
    summary: "La web abre con un certificado válido.", detail: `HTTPS ${res.status} en ${new URL(res.url).host}`, fix: "" });

  // ¿Redirige http -> https?
  try {
    const r = await withTimeout((signal) => fetch(`http://${domain}/`, { redirect: "manual", headers: { "user-agent": UA }, signal }), 6000);
    const loc = r.headers.get("location") ?? "";
    const ok = r.status >= 300 && r.status < 400 && loc.startsWith("https://");
    out.push({ id: "redirect", area: "web", title: "Redirección a HTTPS", level: ok ? "ok" : "warn", weight: 1,
      summary: ok ? "Quien entra por http:// pasa automáticamente a la versión segura." : "Quien entra por http:// se queda en la versión no cifrada.",
      detail: `http:// → ${r.status}${loc ? ` ${loc}` : ""}`, fix: ok ? "" : "Configurar una redirección 301 de http:// a https://." });
  } catch { /* puerto 80 cerrado: no es un problema */ }

  const h = res.headers;
  const missing: string[] = [];
  if (!h.get("strict-transport-security")) missing.push("Strict-Transport-Security");
  if (!h.get("x-content-type-options")) missing.push("X-Content-Type-Options");
  const csp = h.get("content-security-policy") ?? "";
  if (!h.get("x-frame-options") && !/frame-ancestors/i.test(csp)) missing.push("X-Frame-Options / frame-ancestors");
  if (!csp) missing.push("Content-Security-Policy");
  if (!h.get("referrer-policy")) missing.push("Referrer-Policy");
  out.push({ id: "headers", area: "web", title: "Protecciones del navegador", weight: 1,
    level: missing.length === 0 ? "ok" : missing.length <= 2 ? "warn" : "bad",
    summary: missing.length === 0 ? "La web activa las protecciones básicas del navegador." : `Faltan ${missing.length} de 5 protecciones básicas del navegador.`,
    detail: missing.length ? `Ausentes: ${missing.join(", ")}` : "Todas presentes.",
    fix: missing.length ? "Añadir esas cabeceras en el servidor o en el hosting (en WordPress, con un plugin de cabeceras de seguridad)." : "" });

  const server = [h.get("server"), h.get("x-powered-by")].filter(Boolean).join(" · ");
  if (/\d/.test(server)) out.push({ id: "version", area: "web", title: "Versión del software expuesta", level: "warn", weight: 1,
    summary: "La web anuncia qué software y versión usa, lo que facilita buscar fallos conocidos.", detail: server,
    fix: "Ocultar las cabeceras Server / X-Powered-By o quitar el número de versión." });
  return out;
}

async function checkCert(domain: string): Promise<Check | null> {
  // Certificate Transparency (crt.sh): último certificado emitido para el dominio.
  try {
    const r = await withTimeout((signal) => fetch(`https://crt.sh/?q=${encodeURIComponent(domain)}&output=json&exclude=expired`, { headers: { "user-agent": UA }, signal }), 8000);
    if (!r.ok) return null;
    const certs = (await r.json()) as { common_name: string; name_value: string; not_after: string }[];
    const relevant = certs.filter((c) => c.name_value.split("\n").some((n) => n === domain || n === `www.${domain}` || n === `*.${domain}`));
    if (!relevant.length) return null;
    const latest = relevant.map((c) => new Date(c.not_after + "Z")).sort((a, b) => b.getTime() - a.getTime())[0];
    const days = Math.floor((latest.getTime() - Date.now()) / 86400000);
    const date = latest.toLocaleDateString("es-ES");
    return { id: "cert", area: "web", title: "Caducidad del certificado", weight: 1,
      level: days < 7 ? "bad" : days < 21 ? "warn" : "ok",
      summary: days < 21 ? `El certificado caduca en ${days} días (${date}). Si no se renueva, la web mostrará un aviso de peligro.` : `El certificado es válido hasta el ${date}.`,
      detail: `Certificado más reciente en Certificate Transparency: caduca ${latest.toISOString().slice(0, 10)}`,
      fix: days < 21 ? "Comprobar que la renovación automática funciona." : "" };
  } catch { return null; }
}

// ---------- Dominio ----------

async function checkDnssec(domain: string): Promise<Check> {
  const r = await dns(domain, "A");
  return { id: "dnssec", area: "dominio", title: "DNSSEC (firma de las DNS)", weight: 1,
    level: r.AD ? "ok" : "warn",
    summary: r.AD ? "Las respuestas DNS del dominio están firmadas." : "Las DNS no están firmadas: es posible desviar el tráfico con ataques de envenenamiento DNS.",
    detail: r.AD ? "Resolver validó DNSSEC (AD=1)." : "AD=0: sin DNSSEC o mal configurado.",
    fix: r.AD ? "" : "Activar DNSSEC en el registrador (en la mayoría es un botón)." };
}

async function checkExpiry(domain: string): Promise<Check | null> {
  try {
    const r = await withTimeout((signal) => fetch(`https://rdap.org/domain/${domain}`, { headers: { accept: "application/rdap+json", "user-agent": UA }, signal }), 6000);
    if (!r.ok) return null;
    const data = (await r.json()) as { events?: { eventAction: string; eventDate: string }[] };
    const exp = data.events?.find((e) => e.eventAction === "expiration")?.eventDate;
    if (!exp) return null;
    const d = new Date(exp);
    const days = Math.floor((d.getTime() - Date.now()) / 86400000);
    const date = d.toLocaleDateString("es-ES");
    return { id: "expiry", area: "dominio", title: "Caducidad del dominio", weight: 1,
      level: days < 15 ? "bad" : days < 45 ? "warn" : "ok",
      summary: days < 45 ? `El dominio caduca en ${days} días (${date}). Si caduca, se pierden la web y el correo.` : `El dominio está pagado hasta el ${date}.`,
      detail: `RDAP expiration: ${exp}`, fix: days < 45 ? "Renovar y activar la renovación automática." : "" };
  } catch { return null; }
}

// ---------- Informe ----------

export interface Report { domain: string; score: number; grade: Level; date: string; checks: Check[]; provider: string | null }

export async function scanDomain(domain: string): Promise<Report> {
  const { check: mx, provider, hasMx } = await checkMx(domain);
  const [spf, dmarc, web, cert, dnssec, expiry] = await Promise.all([
    checkSpf(domain), checkDmarc(domain), checkWeb(domain), checkCert(domain), checkDnssec(domain), checkExpiry(domain),
  ]);
  const dkim = hasMx ? await checkDkim(domain, provider) : null;
  const checks = [mx, spf, dmarc, dkim, ...web, cert, dnssec, expiry].filter((c): c is Check => c !== null);

  // Nota sobre 10: ok = 100 %, warn = 50 %, bad = 0 %.
  const scored = checks.filter((c) => c.level !== "info" && c.weight > 0);
  const total = scored.reduce((s, c) => s + c.weight, 0);
  const got = scored.reduce((s, c) => s + c.weight * (c.level === "ok" ? 1 : c.level === "warn" ? 0.5 : 0), 0);
  const score = total ? Math.round((got / total) * 100) / 10 : 0;
  const grade: Level = score >= 8 ? "ok" : score >= 5 ? "warn" : "bad";
  return { domain, score, grade, date: new Date().toISOString(), checks, provider };
}
