(() => {
  // =========================
  // CONFIG
  // =========================
  const SHEET_URL =
    "https://docs.google.com/spreadsheets/d/120WSaF1Zu6h4-Edid-Yc7GIWKwtQB61GQ3rNexH-MXc/edit?gid=0#gid=0";

  const DEFAULT_GID = "0";
  const DEFAULT_HEADER_ROW = 1; // 1-based
  const DEFAULT_METRIC_COL = 1; // 1-based
  const DAYS_BACK = 6; // ancla + 6 atrás = 7 tarjetas

  // 🔄 Auto refresh (minutos)
  const REFRESH_MINUTES = 5;
  const REFRESH_MS = REFRESH_MINUTES * 60 * 1000;

  // ✅ Rango de legajos en el Sheet: A16:AC25
  const LEGAJO_ROW_START = 16; // 1-based
  const LEGAJO_ROW_END = 25;   // 1-based
  const LEGAJO_COL_START = 1;  // 1-based (A)
  const LEGAJO_COL_END = 29;   // 1-based (AC)

  // =========================
  // DOM
  // =========================
  const cardsGrid = document.getElementById("cardsGrid");
  if (!cardsGrid) return;

  // =========================
  // STATE
  // =========================
  let dayCards = [];
  let isLoading = false;
  let refreshTimer = null;
  let abortCtrl = null;

  // =========================
  // HELPERS
  // =========================
  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalize(s) {
    return String(s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function extractSpreadsheetId(url) {
    const m = String(url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : "";
  }

  function extractGid(url) {
    // acepta ...?gid=123 o ...#gid=123
    const s = String(url || "");
    const m = s.match(/[?#&]gid=(\d+)/);
    return m ? m[1] : "";
  }

  function parseDate(label) {
    const s = String(label ?? "").trim();
    const m = s.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (!m) return null;

    const dd = Number(m[1]);
    const mm = Number(m[2]) - 1;
    const yRaw = m[3] ? Number(m[3]) : new Date().getFullYear();
    const yyyy = yRaw < 100 ? 2000 + yRaw : yRaw;

    const dt = new Date(yyyy, mm, dd);
    return Number.isNaN(dt.getTime()) ? null : startOfDay(dt);
  }

  function formatDateWithWeekday(d) {
    const weekday = new Intl.DateTimeFormat("es-ES", { weekday: "long" }).format(d);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const w = weekday.charAt(0).toUpperCase() + weekday.slice(1);
    return `${w} ${dd}/${mm}/${yyyy}`;
  }

  // ✅ extractor robusto: agarra TODOS los números (>=3 dígitos) aunque haya texto/símbolos
  function extractLegajos(value) {
    const matches = String(value ?? "").match(/\d{3,}/g);
    return matches ? matches : [];
  }

  function uniqueSortLegajos(legajos) {
    const uniq = Array.from(new Set((legajos || []).map(String)));
    return uniq.sort((a, b) => Number(a) - Number(b));
  }

  function shouldHideInTable(metricName) {
    const n = normalize(metricName);
    if (n === "linea tm") return true;
    if (n === "linea tt") return true;
    if (n.includes("legajo") && n.includes("inasist")) return true;
    if (n === "inasistencias tm") return true;
    if (n === "inasistencias tt") return true;
    return false;
  }

  function showStatus(kind, title, detail) {
    const t = escapeHtml(title || "");
    const d = escapeHtml(detail || "");
    cardsGrid.innerHTML = `
      <div class="status status--${escapeHtml(kind)}" style="padding:14px;border-radius:14px;border:1px solid rgba(255,255,255,.12)">
        <div style="font-weight:700;margin-bottom:6px">${t}</div>
        <div style="opacity:.85;line-height:1.35">${d}</div>
      </div>
    `;
  }

  // =========================
  // CSV PARSER (robusto con comillas/comas)
  // =========================
  function parseCsvToMatrix(text) {
    const rows = [];
    let curRow = [];
    let cur = "";
    let inQuotes = false;

    // normalizar newlines
    const s = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const next = s[i + 1];

      if (ch === '"' && inQuotes && next === '"') {
        cur += '"';
        i++;
        continue;
      }
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes && ch === ",") {
        curRow.push(cur);
        cur = "";
        continue;
      }
      if (!inQuotes && ch === "\n") {
        curRow.push(cur);
        rows.push(curRow);
        curRow = [];
        cur = "";
        continue;
      }
      cur += ch;
    }

    // push final
    curRow.push(cur);
    rows.push(curRow);

    // trim cells + eliminar filas totalmente vacías al final
    const out = rows.map(r => r.map(c => String(c ?? "").trim()));
    while (out.length && out[out.length - 1].every(c => c === "")) out.pop();
    return out;
  }

  // =========================
  // FETCH CSV (NO CACHE + TS)
  // =========================
  async function fetchCsv(spreadsheetId, gid) {
    const url =
      `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}` +
      `/export?format=csv&gid=${encodeURIComponent(gid)}&_ts=${Date.now()}`;

    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();

    const res = await fetch(url, { cache: "no-store", signal: abortCtrl.signal });
    const text = await res.text();

    if (!res.ok || text.trim().startsWith("<")) {
      throw new Error(
        "No se pudo leer el Sheet. Verificá que esté público o publicado (File > Share o Publish to web)."
      );
    }
    return text;
  }

  // =========================
  // LEER LEGAJOS DESDE A16:AC25 PARA UNA COLUMNA (fecha)
  // =========================
  function getLegajosFromRange(matrix, colIndex0) {
    const r0 = LEGAJO_ROW_START - 1;
    const r1 = LEGAJO_ROW_END - 1;
    const c0 = LEGAJO_COL_START - 1;
    const c1 = LEGAJO_COL_END - 1;

    if (colIndex0 < c0 || colIndex0 > c1) return [];
    if (r0 < 0 || r1 >= matrix.length) return [];

    const out = [];
    for (let r = r0; r <= r1; r++) {
      const cell = (matrix[r] && matrix[r][colIndex0]) ? matrix[r][colIndex0] : "";
      out.push(...extractLegajos(cell));
    }
    return uniqueSortLegajos(out);
  }

  // =========================
  // BUILD CARDS
  // =========================
  function buildCards(matrix, headerRow1, metricCol1) {
    const h = headerRow1 - 1;
    const mCol = metricCol1 - 1;

    const header = matrix[h];
    if (!header) throw new Error("Fila de fechas inválida (headerRow).");

    // columnas con fecha
    const cols = [];
    for (let c = 0; c < header.length; c++) {
      if (c === mCol) continue;
      const d = parseDate(header[c]);
      if (d) cols.push({ c, d });
    }
    if (!cols.length) throw new Error("No se detectaron columnas con fechas en el header.");

    const rows = matrix.slice(h + 1);

    return cols.map(({ c, d }) => {
      let lineaTM = "—";
      let lineaTT = "—";
      const table = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] || [];
        const name = String(row[mCol] ?? "").trim();
        const val = String(row[c] ?? "").trim();
        if (!name) continue;

        const n = normalize(name);
        if (n === "linea tm" || n.includes("linea tm")) lineaTM = val || "—";
        if (n === "linea tt" || n.includes("linea tt")) lineaTT = val || "—";

        if (!shouldHideInTable(name)) {
          table.push({ name, val });
        }
      }

      const legajos = getLegajosFromRange(matrix, c);

      return { date: d, lineaTM, lineaTT, legajos, table };
    });
  }

  function windowCards(cards) {
    const today = startOfDay(new Date());
    const valid = cards.filter(c => c.date && c.date <= today);
    if (!valid.length) return [];

    let anchor = valid[0].date;
    for (const c of valid) if (c.date > anchor) anchor = c.date;

    const min = addDays(anchor, -DAYS_BACK);

    return valid
      .filter(c => c.date >= min && c.date <= anchor)
      .sort((a, b) => b.date - a.date);
  }

  // =========================
  // RENDER
  // =========================
  function render() {
    cardsGrid.innerHTML = "";

    const today = startOfDay(new Date());
    const list = windowCards(dayCards);

    if (!list.length) {
      showStatus(
        "warn",
        "Sin datos para mostrar",
        "No encontré columnas con fechas ≤ hoy, o el header no tiene formato dd/mm."
      );
      return;
    }

    list.forEach(card => {
      const isToday = card.date.getTime() === today.getTime();
      const hasInasist = card.legajos.length > 0;

      const el = document.createElement("article");
      el.className = `card ${hasInasist ? "card--alert" : "card--ok"} ${isToday ? "card--today" : ""}`;

      const fechaTxt = formatDateWithWeekday(card.date);

      el.innerHTML = `
        <div class="card-body">
          <div class="card-date">
            <div class="date-pill">
              <span class="dot ${hasInasist ? "dot--red" : "dot--green"}"></span>
              ${escapeHtml(fechaTxt)}
            </div>
          </div>

          <div class="kpi-row">
            <div class="kpi">
              <div class="k">Línea TM</div>
              <div class="v">${escapeHtml(String(card.lineaTM))}</div>
            </div>

            <div class="kpi">
              <div class="k">Línea TT</div>
              <div class="v">${escapeHtml(String(card.lineaTT))}</div>
            </div>

            <div class="kpi">
              <div class="k">Legajo inasistencia</div>
              <div class="v">${escapeHtml(card.legajos.length ? card.legajos.join(", ") : "—")}</div>
            </div>
          </div>

          <div class="table table-scroll">
            ${card.table
              .map(
                r => `
                <div class="row">
                  <div class="key">${escapeHtml(r.name)}</div>
                  <div class="val">${escapeHtml(r.val || "—")}</div>
                </div>`
              )
              .join("")}
          </div>
        </div>
      `;

      cardsGrid.appendChild(el);
    });
  }

  // =========================
  // LOAD + AUTO REFRESH
  // =========================
  async function load() {
    if (isLoading) return;
    isLoading = true;

    showStatus("info", "Cargando…", "Leyendo Google Sheet y actualizando tarjetas.");

    try {
      const id = extractSpreadsheetId(SHEET_URL);
      if (!id) throw new Error("No pude extraer el ID del Sheet desde la URL.");

      const gid = extractGid(SHEET_URL) || DEFAULT_GID;

      const csv = await fetchCsv(id, gid);
      const matrix = parseCsvToMatrix(csv);

      dayCards = buildCards(matrix, DEFAULT_HEADER_ROW, DEFAULT_METRIC_COL);
      render();
    } catch (err) {
      console.error(err);
      showStatus("error", "Error al leer el Sheet", err?.message || String(err));
    } finally {
      isLoading = false;
    }
  }

  function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") load();
  });

  load();
  startAutoRefresh();
})();
