(() => {
  // =========================
  // CONFIG
  // =========================
  const SHEET_URL =
    "https://docs.google.com/spreadsheets/d/120WSaF1Zu6h4-Edid-Yc7GIWKwtQB61GQ3rNexH-MXc/edit?gid=0#gid=0";

  const DEFAULT_GID = "0";
  const DEFAULT_HEADER_ROW = 1;
  const DEFAULT_METRIC_COL = 1;
  const DAYS_BACK = 6;

  console.log("APP VERSION FINAL – KPI LEGAJOS");

  // =========================
  // DOM
  // =========================
  const gidInput = document.getElementById("gidInput");
  const headerRowInput = document.getElementById("headerRowInput");
  const metricColInput = document.getElementById("metricColInput");
  const reloadBtn = document.getElementById("reloadBtn");
  const applyBtn = document.getElementById("applyBtn");
  const searchInput = document.getElementById("searchInput");
  const cardsGrid = document.getElementById("cardsGrid");

  let dayCards = [];

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

  function extractSpreadsheetId(url) {
    const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : "";
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function addDays(d, days) {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    return x;
  }

  function normalize(s) {
    return String(s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractLegajos(value) {
    return String(value ?? "")
      .split(/[\s,;|]+/)
      .map(v => v.trim())
      .filter(v => /^\d{3,}$/.test(v));
  }

  // =========================
  // FETCH CSV
  // =========================
  async function fetchCsv(spreadsheetId, gid) {
    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
      spreadsheetId
    )}/export?format=csv&gid=${encodeURIComponent(gid)}`;

    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();

    if (!res.ok || text.trim().startsWith("<")) {
      throw new Error("El Google Sheet no es público o no está publicado.");
    }
    return text;
  }

  // =========================
  // CSV → MATRIX
  // =========================
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const n = text[i + 1];

      if (c === '"' && inQuotes && n === '"') {
        field += '"';
        i++;
        continue;
      }
      if (c === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes && c === ",") {
        row.push(field);
        field = "";
        continue;
      }
      if (!inQuotes && c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        continue;
      }
      if (c !== "\r") field += c;
    }

    row.push(field);
    rows.push(row);

    return rows.map(r => r.map(c => String(c ?? "").trim()));
  }

  // =========================
  // FECHAS
  // =========================
  function parseDate(label) {
    const m = String(label).match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (!m) return null;

    const d = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const y = m[3] ? Number(m[3]) : new Date().getFullYear();
    return startOfDay(new Date(y < 100 ? 2000 + y : y, mo, d));
  }

  // =========================
  // BUILD CARDS
  // =========================
  function buildCards(matrix, headerRow, metricCol) {
    const h = headerRow - 1;
    const mCol = metricCol - 1;
    const header = matrix[h];

    const cols = [];
    header.forEach((label, c) => {
      if (c === mCol) return;
      const d = parseDate(label);
      if (d) cols.push({ c, d });
    });

    const rows = matrix.slice(h + 1);

    return cols.map(({ c, d }) => {
      const metrics = [];
      let lineaTM = "";
      let lineaTT = "";
      let legajosInasist = [];

      rows.forEach(r => {
        const name = r[mCol];
        if (!name) return;

        const value = r[c];
        metrics.push({ name, value });

        const n = normalize(name);

        if (n.includes("linea tm")) lineaTM = value || "";
        if (n.includes("linea tt")) lineaTT = value || "";

        // 🔥 SOLO LEGAJOS (no suma números)
        if (n.includes("legajo") && n.includes("inasist")) {
          legajosInasist = extractLegajos(value);
        }
      });

      return {
        date: d,
        metrics,
        lineaTM,
        lineaTT,
        legajosInasist
      };
    });
  }

  // =========================
  // WINDOW + SORT
  // =========================
  function windowCards(cards) {
    const today = startOfDay(new Date());
    const valid = cards.filter(c => c.date <= today);
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

    windowCards(dayCards).forEach(card => {
      const el = document.createElement("article");
      el.className = "card";

      const legajosTxt =
        card.legajosInasist.length
          ? card.legajosInasist.join(", ")
          : "—";

      el.innerHTML = `
        <div class="card-body">
          <div class="kpi-row">
            <div class="kpi">
              <div class="k">Línea TM</div>
              <div class="v">${escapeHtml(card.lineaTM)}</div>
            </div>
            <div class="kpi">
              <div class="k">Línea TT</div>
              <div class="v">${escapeHtml(card.lineaTT)}</div>
            </div>
            <div class="kpi">
              <div class="k">Inasistencia</div>
              <div class="v">${escapeHtml(legajosTxt)}</div>
            </div>
          </div>

          <div class="table table-scroll">
            ${card.metrics.map(m => `
              <div class="row">
                <div class="key">${escapeHtml(m.name)}</div>
                <div class="val">${escapeHtml(m.value || "—")}</div>
              </div>
            `).join("")}
          </div>
        </div>
      `;

      cardsGrid.appendChild(el);
    });
  }

  // =========================
  // LOAD
  // =========================
  async function load() {
    const id = extractSpreadsheetId(SHEET_URL);
    const csv = await fetchCsv(id, gidInput?.value || DEFAULT_GID);
    const matrix = parseCsv(csv);

    dayCards = buildCards(
      matrix,
      Number(headerRowInput?.value || DEFAULT_HEADER_ROW),
      Number(metricColInput?.value || DEFAULT_METRIC_COL)
    );

    render();
  }

  reloadBtn && (reloadBtn.onclick = load);
  applyBtn && (applyBtn.onclick = load);

  load();
})();
