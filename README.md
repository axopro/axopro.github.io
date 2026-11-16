# Proyectos en axopro.github.io

| Proyecto | URL | Qué es |
|---|---|---|
| **Escáner de seguridad** | `/escaner/` | Informe en español de la seguridad del correo, la web y el dominio de una pyme |
| FórmulaFácil | `/` | Fórmulas de Excel/Sheets en español con IA |

Los dos comparten el mismo Cloudflare Worker (`worker/`): `GET /scan?d=dominio` para el escáner y `POST /` para las fórmulas.

## Escáner de seguridad

**Probarlo en tu PC:** doble clic en `arrancar.bat` (Windows) o `./arrancar.sh` (Mac/Linux). Abre `http://localhost:8080/escaner/`. Requiere Node.js.

Análisis **pasivo**: solo información pública. No escanea puertos ni prueba credenciales.

| Área | Comprobación | Fuente |
|---|---|---|
| Correo | MX y proveedor, SPF, DMARC, DKIM (24 selectores comunes) | DNS sobre HTTPS (Cloudflare) |
| Web | HTTPS, redirección http→https, cabeceras de seguridad, versión expuesta | petición HTTPS |
| Web | Caducidad del certificado | Certificate Transparency (crt.sh) |
| Dominio | DNSSEC, caducidad del dominio | DoH (bit AD), RDAP (rdap.org; .es no publica RDAP) |

- Nota de 0 a 10 ponderada (DMARC pesa más). Textos fijos en español, sin IA: coste por análisis ≈ 0 €.
- Límite: 30 análisis por IP y día (`SCAN_DAILY_LIMIT`). Resultados en caché 1 h.
- El técnico pone su nombre y teléfono en «Tu marca» y salen en el PDF (`Descargar PDF` usa la impresión del navegador).
- Ejemplo de informe: `escaner/informe-ejemplo.pdf`.
- Pruebas: `cd worker && npm test` (DNS y HTTP simulados).

**Uso legal:** el análisis es de datos públicos, pero para captar clientes no envíes correos masivos en frío (LSSI/RGPD). Visita, llama o usa LinkedIn.

---

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
