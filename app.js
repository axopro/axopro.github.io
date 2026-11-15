(() => {
  const $ = (id) => document.getElementById(id);
  const cfg = window.FF_CONFIG;
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  const EXAMPLES = {
    generar: [
      "Suma C2:C100 si A es «Madrid»",
      "Busca el precio del código de A2 en la hoja Productos",
      "Cuenta los días laborables entre B2 y C2",
    ],
    explicar: ["=SI.ERROR(BUSCARV(A2;Hoja2!A:C;3;FALSO);\"No existe\")", "=SUMAPRODUCTO((A2:A50=\"Sí\")*(B2:B50))"],
    script: ["Envía un email cuando una celda de la columna D pase a «Urgente»", "Copia las filas con estado «Pagado» a otra hoja"],
  };
  const LABEL = { generar: "Generar", explicar: "Explicar", script: "Crear script" };
  let mode = "generar";

  function renderExamples() {
    $("examples").innerHTML = "";
    for (const ex of EXAMPLES[mode]) {
      const b = document.createElement("button");
      b.className = "chip"; b.type = "button"; b.textContent = ex;
      b.onclick = () => { $("input").value = ex; $("input").focus(); };
      $("examples").appendChild(b);
    }
    $("go").textContent = LABEL[mode];
  }

  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    mode = t.dataset.mode;
    renderExamples();
  }));

  // Preferencias recordadas
  for (const id of ["platform", "lang", "license"]) {
    const v = store.get("ff_" + id, null);
    if (v) $(id).value = v;
    $(id).addEventListener("change", () => store.set("ff_" + id, $(id).value.trim()));
  }

  function renderHistory() {
    const h = store.get("ff_hist", []);
    $("hist").innerHTML = "";
    for (const item of h) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="muted"></span><code></code>`;
      li.querySelector("span").textContent = item.q;
      li.querySelector("code").textContent = item.r;
      li.onclick = () => navigator.clipboard?.writeText(item.r);
      $("hist").appendChild(li);
    }
    $("hist-wrap").hidden = h.length === 0;
  }

  async function run() {
    const input = $("input").value.trim();
    if (input.length < 3) return;
    $("go").disabled = true; $("go").textContent = "Pensando…";
    $("err").hidden = true;
    try {
      const res = await fetch(cfg.API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode, input,
          platform: $("platform").value,
          lang: $("lang").value,
          license: $("license").value.trim() || undefined,
        }),
      });
      const data = await res.json();
      const left = res.headers.get("X-Remaining");
      if (data.pro) $("quota").textContent = "Pro activo";
      else if (left !== null) $("quota").textContent = `Te quedan ${left} consultas gratis hoy`;
      if (!res.ok) throw new Error(data.error || "Error");

      $("res").textContent = data.resultado;
      $("exp").textContent = data.explicacion;
      $("ej").textContent = data.ejemplo;
      $("out").hidden = false;

      const h = store.get("ff_hist", []);
      h.unshift({ q: input, r: data.resultado });
      store.set("ff_hist", h.slice(0, data.pro ? 200 : 20));
      renderHistory();
    } catch (e) {
      $("err").textContent = e.message === "Failed to fetch" ? "No hay conexión con el servidor." : e.message;
      $("err").hidden = false;
    } finally {
      $("go").disabled = false; $("go").textContent = LABEL[mode];
    }
  }

  $("go").addEventListener("click", run);
  $("input").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run(); });
  $("copy").addEventListener("click", async () => {
    await navigator.clipboard?.writeText($("res").textContent);
    $("copy").textContent = "¡Copiado!"; setTimeout(() => ($("copy").textContent = "Copiar"), 1200);
  });
  $("buy").href = cfg.CHECKOUT_URL;

  renderExamples();
  renderHistory();
})();
