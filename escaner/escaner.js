(() => {
  const $ = (id) => document.getElementById(id);
  const API = window.FF_CONFIG.API_URL.replace(/\/$/, "") + "/scan";
  const store = {
    get(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  const BADGE = { bad: "Crítico", warn: "Mejorable", ok: "Correcto", info: "Info" };
  const AREA = {
    correo: { name: "Correo electrónico", icon: "i-mail" },
    web: { name: "Página web", icon: "i-globe" },
    dominio: { name: "Dominio", icon: "i-server" },
  };
  const VERDICT = {
    ok: ["Buena protección", "La configuración es sólida. Conviene revisarla cada pocos meses."],
    warn: ["Protección mejorable", "Hay puntos débiles que conviene corregir pronto."],
    bad: ["Riesgo alto", "La empresa es fácil de suplantar o su web no transmite confianza."],
  };
  const ORDER = { bad: 0, warn: 1, ok: 2, info: 3 };

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const icon = (id, cls = "ico") => {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", cls);
    const use = document.createElementNS(ns, "use");
    use.setAttribute("href", "#" + id);
    svg.append(use);
    return svg;
  };

  // ---------- Marca del técnico ----------
  const BRAND = ["name", "phone", "email", "web"];
  function renderBrand() {
    const b = Object.fromEntries(BRAND.map((k) => [k, store.get("esc_" + k)]));
    const contact = [b.phone, b.email, b.web].filter(Boolean).join("  ·  ");
    const has = Boolean(b.name || contact);

    const head = $("brand");
    head.replaceChildren();
    head.hidden = !has;
    if (has) head.append(el("strong", null, b.name || "Informe preparado por"), el("span", null, contact));

    const foot = $("brand-foot");
    foot.replaceChildren();
    foot.hidden = !has;
    if (has) {
      const left = el("div");
      left.append(el("strong", null, "¿Quieres que lo resolvamos?"), el("br"), el("span", null, "Corregir estos puntos suele llevar entre una y dos horas."));
      foot.append(left, el("span", null, [b.name, contact].filter(Boolean).join("  ·  ")));
    }
  }
  for (const k of BRAND) {
    const input = $("b-" + k);
    input.value = store.get("esc_" + k);
    input.addEventListener("input", () => { store.set("esc_" + k, input.value.trim()); renderBrand(); });
  }

  // ---------- Informe ----------
  function renderCheck(c) {
    const hasBody = Boolean(c.fix || c.detail);
    const d = el("details", "check " + c.level + (hasBody ? "" : " no-body"));
    const s = el("summary");
    const chev = icon("i-arrow", "ico chev");
    s.append(el("span", "badge " + c.level, BADGE[c.level]), el("span", "check-title", c.title), chev, el("span", "check-sum", c.summary));
    d.append(s);
    if (hasBody) {
      const body = el("div", "check-body");
      if (c.fix) {
        const fix = el("div", "fix");
        fix.append(el("b", null, "Cómo solucionarlo"), document.createTextNode(c.fix));
        body.append(fix);
      }
      if (c.detail) body.append(el("code", "tech", c.detail));
      d.append(body);
    } else {
      s.addEventListener("click", (e) => e.preventDefault());
    }
    // Lo grave, abierto por defecto
    if (hasBody && c.level === "bad") d.open = true;
    return d;
  }

  function renderReport(r) {
    $("r-domain").textContent = r.domain;
    $("r-date").textContent = "Analizado el " + new Date(r.date).toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" });
    $("r-num").textContent = String(r.score).replace(".", ",");
    $("r-score").className = "ring " + r.grade;
    $("r-arc").style.setProperty("--p", "0");
    requestAnimationFrame(() => requestAnimationFrame(() => $("r-arc").style.setProperty("--p", String(r.score / 10))));
    const [title, sub] = VERDICT[r.grade];
    $("r-verdict").textContent = title;
    $("r-verdict-sub").textContent = sub;
    for (const lvl of ["bad", "warn", "ok"]) $("c-" + lvl).textContent = r.checks.filter((c) => c.level === lvl).length;

    const groups = $("r-groups");
    groups.replaceChildren();
    for (const key of ["correo", "web", "dominio"]) {
      const checks = r.checks.filter((c) => c.area === key).sort((a, b) => ORDER[a.level] - ORDER[b.level]);
      if (!checks.length) continue;
      const area = el("section", "area");
      const head = el("div", "area-head");
      const issues = checks.filter((c) => c.level === "bad" || c.level === "warn").length;
      head.append(icon(AREA[key].icon), el("h3", null, AREA[key].name), el("span", "area-meta", issues ? `${issues} ${issues === 1 ? "punto a revisar" : "puntos a revisar"}` : "Sin incidencias"));
      area.append(head, ...checks.map(renderCheck));
      groups.append(area);
    }
    $("report").hidden = false;
    $("report").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- Análisis ----------
  async function scan(domain) {
    const go = $("go");
    $("err").hidden = true;
    go.disabled = true;
    go.firstChild.textContent = "Analizando… ";
    try {
      const res = await fetch(`${API}?d=${encodeURIComponent(domain)}`);
      const data = await res.json();
      const left = res.headers.get("X-Remaining");
      if (left !== null) $("quota").textContent = `Te quedan ${left} análisis gratuitos hoy.`;
      if (!res.ok) throw new Error(data.error || "Error");
      renderReport(data);
      history.replaceState(null, "", `?d=${encodeURIComponent(data.domain)}`);
      document.title = `Informe de seguridad · ${data.domain}`;
    } catch (e) {
      $("err").textContent = e.message === "Failed to fetch" ? "No hay conexión con el servidor de análisis." : e.message;
      $("err").hidden = false;
    } finally {
      go.disabled = false;
      go.firstChild.textContent = "Analizar ";
    }
  }

  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const d = $("domain").value.trim();
    if (d) scan(d);
  });
  $("tech").addEventListener("change", () => document.body.classList.toggle("hide-tech", !$("tech").checked));
  $("new").addEventListener("click", () => { $("domain").value = ""; window.scrollTo({ top: 0, behavior: "smooth" }); $("domain").focus(); });

  // En el PDF van todos los puntos desplegados; al volver se restaura.
  let openState = [];
  window.addEventListener("beforeprint", () => {
    openState = [...document.querySelectorAll(".check")].map((d) => d.open);
    document.querySelectorAll(".check").forEach((d) => { d.open = true; });
  });
  window.addEventListener("afterprint", () => {
    document.querySelectorAll(".check").forEach((d, i) => { d.open = openState[i] ?? d.open; });
  });
  $("pdf").addEventListener("click", () => window.print());

  renderBrand();
  const pre = new URLSearchParams(location.search).get("d");
  if (pre) { $("domain").value = pre; scan(pre); }
})();
