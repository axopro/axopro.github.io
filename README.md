# FórmulaFácil

MicroSaaS: describes en español lo que quieres y te devuelve la fórmula de Excel / Google Sheets **con nombres en español y separador `;`** (el hueco que dejan las herramientas en inglés).

## Arquitectura

| Parte | Dónde | Archivos |
|---|---|---|
| Web (landing + app) | GitHub Pages (`https://axopro.github.io`) | `index.html`, `app.js`, `styles.css`, `config.js` |
| API | Cloudflare Workers (plan gratis: 100.000 peticiones/día) | `worker/` |
| IA | API de Anthropic (Claude) | clave guardada como secret del Worker |
| Límite gratis y licencias | Cloudflare KV | binding `USAGE` |
| Cobros | Lemon Squeezy (actúa como Merchant of Record, gestiona el IVA) | enlace en `config.js` |

La clave de la API nunca llega al navegador.

## Puesta en marcha

1. **API key**: crea una en https://console.anthropic.com y añade saldo.
2. **Worker**:
   ```bash
   cd worker
   npm install
   npx wrangler login
   npx wrangler kv namespace create USAGE   # copia el id a wrangler.toml
   npx wrangler secret put ANTHROPIC_API_KEY
   npm run deploy                           # te da la URL *.workers.dev
   ```
3. **Web**: pon esa URL en `API_URL` de `config.js`.
4. **GitHub Pages**: Settings → Pages → rama con estos archivos, carpeta `/`.
5. **Cobros**: crea en Lemon Squeezy un producto de suscripción de 4,99 €/mes y pega el enlace en `CHECKOUT_URL`.

## Dar de alta un cliente Pro

Tras cada venta, genera una clave y actívala:

```bash
cd worker
npx wrangler kv key put --binding=USAGE --remote "license:$(openssl rand -hex 12)" active
```

Envía la clave al cliente. Para darlo de baja: `wrangler kv key delete --binding=USAGE --remote "license:<clave>"`.

(Siguiente paso: automatizarlo con el webhook de Lemon Squeezy.)

## Configuración (`worker/wrangler.toml`)

- `FREE_DAILY_LIMIT`: consultas gratis por IP y día (5).
- `MODEL`: modelo de Claude. Por defecto `claude-opus-5-5`. Para abaratar el plan gratis, `claude-haiku-5-5` cuesta 40 veces menos por token.
- `ALLOWED_ORIGIN`: dominio de la web (CORS).

## Desarrollo local

```bash
cd worker && echo "ANTHROPIC_API_KEY=sk-ant-..." > .dev.vars && npm run dev   # API en :8787
# en otra terminal, desde la raíz:
python3 -m http.server 8080   # y pon API_URL = http://localhost:8787 en config.js
```
