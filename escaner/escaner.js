(() => {
  const $ = (id) => document.getElementById(id);
  const API = window.FF_CONFIG.API_URL.replace(/\/$/, "") + "/scan";
  const store = {
    get(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const ICON = { ok: "✓", warn: "!", bad: "✕", info: "i" };
  const AREA = { correo: "Correo electrónico", web: "Página web", dominio: "Dominio" };
  const VERDICT = {
    ok: "Buena configuración. Conviene revisarla cada pocos meses.",
    warn: "Hay puntos débiles que conviene corregir pronto.",
    bad: "Hay riesgos serios: la empresa es fácil de suplantar o su web no es fiable.",
  };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // ---- Marca del técnico ----
  const BRAND = ["name", "phone", "email", "web"];
  function renderBrand() {
    const b = Object.fromEntries(BRAND.map((k) => [k, store.get("esc_" + k)]));
    const contact = [b.phone, b.email, b.web].filter(Boolean).join(" · ");
    for (const id of ["brand", "brand-foot"]) {
      const box = $(id); box.innerHTML = "";
      if (!b.name && !contact) { box.hidden = true; continue; }
      box.hidden = false;
      if (id === "brand") { box.append(el("strong", null, b.name)); if (contact) box.append(el("span", "muted small", contact)); }
      else box.append(el("p", null, `¿Quieres que lo arreglemos? ${b.name ? b.name + " · " : ""}${contact}`));
    }
  }
  for (const k of BRAND) {
    const input = $("b-" + k);
    input.value = store.get("esc_" + k);
    input.addEventListener("input", () => { store.set("esc_" + k, input.value.trim()); renderBrand(); });
  }

  // ---- Informe ----
  function renderReport(r) {
    $("r-domain").textContent = r.domain;
    $("r-date").textContent = new Date(r.date).toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" });
    $("r-num").textContent = String(r.score).replace(".", ",");
    $("r-score").className = "score " + r.grade;
    $("r-verdict").textContent = VERDICT[r.grade];
    const groups = $("r-groups"); groups.innerHTML = "";
    for (const area of ["correo", "web", "dominio"]) {
      const checks = r.checks.filter((c) => c.area === area);
      if (!checks.length) continue;
      const g = el("div", "group");
      g.append(el("h3", null, AREA[area]));
      // Primero lo grave
      const order = { bad: 0, warn: 1, ok: 2, info: 3 };
      checks.sort((a, b) => order[a.level] - order[b.level]);
      for (const c of checks) {
        const row = el("div", "check " + c.level);
        row.append(el("span", "dot", ICON[c.level]));
        const body = el("div", "body");
        body.append(el("strong", null, c.title), el("p", null, c.summary));
        if (c.fix) body.append(el("p", "fix", "Cómo arreglarlo: " + c.fix));
        if (c.detail) body.append(el("code", "tech", c.detail));
        row.append(body);
        g.append(row);
      }
      groups.append(g);
    }
    $("report").hidden = false;
    $("report").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function scan(domain) {
    $("err").hidden = true;
    $("go").disabled = true; $("go").textContent = "Analizando…";
    try {
      const res = await fetch(`${API}?d=${encodeURIComponent(domain)}`);
      const data = await res.json();
      const left = res.headers.get("X-Remaining");
      if (left !== null) $("quota").textContent = `Te quedan ${left} análisis hoy.`;
      if (!res.ok) throw new Error(data.error || "Error");
      renderReport(data);
      history.replaceState(null, "", `?d=${encodeURIComponent(data.domain)}`);
      document.title = `Informe ${data.domain}`;
    } catch (e) {
      $("err").textContent = e.message === "Failed to fetch" ? "No hay conexión con el servidor." : e.message;
      $("err").hidden = false;
    } finally {
      $("go").disabled = false; $("go").textContent = "Analizar";
    }
  }

  $("form").addEventListener("submit", (e) => { e.preventDefault(); const d = $("domain").value.trim(); if (d) scan(d); });
  $("tech").addEventListener("change", () => document.body.classList.toggle("hide-tech", !$("tech").checked));
  $("pdf").addEventListener("click", () => window.print());

  renderBrand();
  const pre = new URLSearchParams(location.search).get("d");
  if (pre) { $("domain").value = pre; scan(pre); }
})();
