// En tu PC (localhost) usa el Worker local de `npm run dev`; publicado, el de Cloudflare.
// Cambia API_URL de producción tras desplegar el Worker, y CHECKOUT_URL tras crear el producto de pago.
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
window.FF_CONFIG = {
  API_URL: LOCAL ? "http://localhost:8787" : "https://formulafacil-api.TU-SUBDOMINIO.workers.dev",
  CHECKOUT_URL: "https://TU-TIENDA.lemonsqueezy.com/buy/XXXX",
};
