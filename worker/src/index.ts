import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { normalizeDomain, scanDomain } from "./scan";

export interface Env {
  ANTHROPIC_API_KEY: string;
  ALLOWED_ORIGIN: string; // p. ej. https://axopro.github.io
  FREE_DAILY_LIMIT: string; // consultas gratis por IP y día
  MODEL: string;
  SCAN_DAILY_LIMIT: string; // escaneos por IP y día
  USAGE: KVNamespace; // contadores diarios + licencias Pro
}

const ReqSchema = z.object({
  mode: z.enum(["generar", "explicar", "script"]),
  input: z.string().trim().min(3).max(2000),
  platform: z.enum(["excel", "sheets"]),
  lang: z.enum(["es", "en"]),
  license: z.string().max(64).optional(),
});

const Answer = z.object({
  resultado: z.string(),
  explicacion: z.string(),
  ejemplo: z.string(),
});

const SCHEMA = {
  type: "object",
  properties: {
    resultado: { type: "string", description: "Fórmula, script o resumen; sin markdown" },
    explicacion: { type: "string", description: "Explicación paso a paso, breve" },
    ejemplo: { type: "string", description: "Ejemplo con datos concretos" },
  },
  required: ["resultado", "explicacion", "ejemplo"],
  additionalProperties: false,
};

function systemPrompt(r: z.infer<typeof ReqSchema>): string {
  const app = r.platform === "excel" ? "Microsoft Excel" : "Google Sheets";
  const locale =
    r.lang === "es"
      ? "Usa los nombres de función en ESPAÑOL (SUMA, SI, BUSCARV, BUSCARX, CONTAR.SI.CONJUNTO...) y el punto y coma ; como separador de argumentos, y coma decimal."
      : "Use ENGLISH function names (SUM, IF, VLOOKUP, XLOOKUP...) and comma , as argument separator.";
  const task = {
    generar: `Devuelve en "resultado" UNA sola fórmula de ${app} lista para pegar, empezando por =.`,
    explicar: `El usuario pega una fórmula de ${app}. En "resultado" pon un resumen de una línea de lo que hace. Si tiene un error, dilo y da la fórmula corregida en "explicacion".`,
    script:
      r.platform === "excel"
        ? `Devuelve en "resultado" una macro VBA completa y comentada.`
        : `Devuelve en "resultado" un script de Google Apps Script completo y comentado.`,
  }[r.mode];
  return [
    `Eres un experto en hojas de cálculo (${app}). Respondes en español de España, claro y breve.`,
    locale,
    task,
    `Si faltan datos (rangos, columnas), asume rangos razonables (A2:A100) y dilo en "explicacion".`,
    `Si la petición no tiene nada que ver con hojas de cálculo, pon "Solo ayudo con hojas de cálculo." en "resultado" y deja el resto vacío.`,
  ].join("\n");
}

function cors(env: Env, origin: string | null): Record<string, string> {
  const allowed = origin && (origin === env.ALLOWED_ORIGIN || origin.startsWith("http://localhost"));
  return {
    "Access-Control-Allow-Origin": allowed ? origin! : env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "X-Remaining",
    Vary: "Origin",
  };
}

function json(data: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const h = cors(env, req.headers.get("Origin"));
    if (req.method === "OPTIONS") return new Response(null, { headers: h });
    if (new URL(req.url).pathname === "/scan") return handleScan(req, env, h);
    if (req.method !== "POST") return json({ error: "Método no permitido" }, 405, h);

    const parsed = ReqSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: "Petición inválida (mín. 3 caracteres, máx. 2000)." }, 400, h);
    const body = parsed.data;

    // Pro: licencia guardada en KV como "license:<clave>" -> "active"
    const isPro = body.license ? (await env.USAGE.get(`license:${body.license}`)) === "active" : false;

    let remaining = -1;
    let usageKey = "";
    let used = 0;
    if (!isPro) {
      const ip = req.headers.get("CF-Connecting-IP") ?? "anon";
      const day = new Date().toISOString().slice(0, 10);
      usageKey = `use:${day}:${ip}`;
      used = Number((await env.USAGE.get(usageKey)) ?? 0);
      const limit = Number(env.FREE_DAILY_LIMIT || 5);
      if (used >= limit) {
        return json({ error: `Has usado tus ${limit} consultas gratis de hoy. Pásate a Pro para uso ilimitado.`, limit: true }, 429, { ...h, "X-Remaining": "0" });
      }
      remaining = limit - used - 1;
    }

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    try {
      const res = await client.beta.messages.create({
        model: env.MODEL || "claude-opus-5-5",
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        system: systemPrompt(body),
        messages: [{ role: "user", content: body.input }],
      });

      if (res.stop_reason === "refusal") return json({ error: "No puedo ayudar con esa petición." }, 422, h);
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      const answer = Answer.safeParse(JSON.parse(text));
      if (!answer.success) return json({ error: "Respuesta no válida, inténtalo de nuevo." }, 502, h);

      if (!isPro) await env.USAGE.put(usageKey, String(used + 1), { expirationTtl: 60 * 60 * 26 });
      return json({ ...answer.data, pro: isPro }, 200, { ...h, "X-Remaining": String(remaining) });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) return json({ error: "Mucha demanda ahora mismo. Prueba en unos segundos." }, 503, h);
      if (err instanceof Anthropic.APIError) {
        console.error("Anthropic", err.status, err.message);
        return json({ error: "Error del servicio de IA." }, 502, h);
      }
      console.error(err);
      return json({ error: "Error interno." }, 500, h);
    }
  },
};

async function handleScan(req: Request, env: Env, h: Record<string, string>): Promise<Response> {
  if (req.method !== "GET") return json({ error: "Método no permitido" }, 405, h);
  const domain = normalizeDomain(new URL(req.url).searchParams.get("d") ?? "");
  if (!domain) return json({ error: "Escribe un dominio válido, por ejemplo: miempresa.es" }, 400, h);

  // Caché de 1 h por dominio: no cuenta para el límite.
  const cacheKey = `scan:${domain}`;
  const cached = await env.USAGE.get(cacheKey);
  if (cached) return new Response(cached, { headers: { ...h, "Content-Type": "application/json; charset=utf-8", "X-Cache": "HIT" } });

  const ip = req.headers.get("CF-Connecting-IP") ?? "anon";
  const usageKey = `scanuse:${new Date().toISOString().slice(0, 10)}:${ip}`;
  const used = Number((await env.USAGE.get(usageKey)) ?? 0);
  const limit = Number(env.SCAN_DAILY_LIMIT || 30);
  if (used >= limit) return json({ error: `Has llegado al límite de ${limit} análisis de hoy.` }, 429, { ...h, "X-Remaining": "0" });

  try {
    const report = await scanDomain(domain);
    const body = JSON.stringify(report);
    await Promise.all([
      env.USAGE.put(usageKey, String(used + 1), { expirationTtl: 60 * 60 * 26 }),
      env.USAGE.put(cacheKey, body, { expirationTtl: 3600 }),
    ]);
    return new Response(body, { headers: { ...h, "Content-Type": "application/json; charset=utf-8", "X-Remaining": String(limit - used - 1) } });
  } catch (err) {
    console.error("scan", domain, err);
    return json({ error: "No se pudo analizar el dominio. Inténtalo de nuevo." }, 502, h);
  }
}
