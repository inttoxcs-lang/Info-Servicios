(() => {
  // ==== CONFIG: tu Sheet ya cargado ====
  const DEFAULT_SHEET_URL =
    "https://docs.google.com/spreadsheets/d/120WSaF1Zu6h4-Edid-Yc7GIWKwtQB61GQ3rNexH-MXc/edit?gid=0#gid=0";

  // Ajustes por defecto (podés cambiarlos desde la UI)
  const DEFAULT_GID = "0";
  const DEFAULT_HEADER_ROW = 1;  // fila donde están las fechas (1-based)
  const DEFAULT_METRIC_COL = 1;  // columna donde están las métricas (A=1)

  // ==== DOM ====
  const sheetUrlInput = document.getElementById("sheetUrl");
  const gidInput = document.getElementById("gidInput");
  const headerRowInput = document.getElementById("headerRowInput");
  const metricColInput = document.getElementById("metricColInput");
  const loadBtn = document.getElementById("applyBtn");
  const reloadBtn = document.getElementById("reloadBtn");
  const openSheetBtn = document.getElementById("openSheetBtn");
  const searchInput = document.getElementById("searchInput");
  const cardsGrid = document.getElementById("cardsGrid");
  const hint = document.getElementById("hint");

  const detailModal = document.getElementById("detailModal");
  const closeModalBtn = document.getElementById("closeModalBtn");
  const modalTitle = document.getElementById("modalTitle");
  const modalSubtitle = document.getElementById("modalSubtitle");
  const modalBody = document.getElementById("modalBody");

  // ==== State ====
  let dayCards = []; // [{ dayLabel, metrics: [{name,value}], searchBlob }]
  let filteredCards = [];

  // ==== Init UI ====
  sheetUrlInput.value = DEFAULT_SHEET_URL;
  gidInput.value = DEFAULT_GID;
  headerRowInput.value = String(DEFAULT_HEADER_ROW);
  metricColInput.value = String(DEFAULT_METRIC_COL);

  openSheetBtn.addEventListener("click", () => window.open(DEFAULT_SHEET_URL, "_blank", "noopener,noreferrer"));

  // ==== Helpers ====
  const showHint = (text, tone = "info") => {
    const colors = {
      info: "rgba(255,255,255,0.68)",
      warn: "rgba(245,158,11,0.95)",
      danger: "rgba(239,68,68,0.95)",
      ok: "rgba(34,197,94,0.95)",
    };
    hint.textContent = text;
    hint.style.color = colors[tone] || colors.info;
  };

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

  async function fetchCsv(spreadsheetId, gid) {
    const csvUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/export?format=csv&gid=${encodeURIComponent(gid)}`;
    const res = await fetch(csvUrl, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(
        `No pude descargar CSV (HTTP ${res.status}). ` +
        `Asegurate de que el Sheet esté publicado o público (lectura).`
      );
    }
    return await res.text();
  }

  // CSV -> matrix (soporta comillas)
  function parseCsvToMatrix(text) {
    const rows = [];
    let cur = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];

      if (ch === '"' && inQuotes && next === '"') {
        field += '"'; i++;
        continue;
      }
      if (ch === '"') { inQuotes = !inQuotes; continue; }

      if (!inQuotes && ch === ",") {
        cur.push(field); field = "";
        continue;
      }
      if (!inQuotes && ch === "\n") {
        cur.push(field); field = "";
        rows.push(cur);
        cur = [];
        continue;
      }
      if (ch !== "\r") field += ch;
    }
    cur.push(field);
    rows.push(cur);

    return rows.map(r => r.map(c => String(c ?? "").trim()));
  }

  // Detecta "día" en header: 01/02, 1/2, 2026-02-01, 01/02/2026...
  function looksLikeDayLabel(s) {
    if (!s) return false;
    const t = s.trim();
    if (/^\d{1,2}\/\d{1,2}$/.test(t)) return true;
    if (/^\d{1,2}-\d{1,2}$/.test(t)) return true;
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return true;
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(t)) return true;
    return false;
  }

  function buildCardsFromMatrix(matrix, headerRow1Based, metricCol1Based) {
    const headerRowIdx = Math.max(1, Number(headerRow1Based || 1)) - 1;
    const metricColIdx = Math.max(1, Number(metricCol1Based || 1)) - 1;

    if (!matrix[headerRowIdx]) throw new Error("La fila de fechas indicada no existe.");

    const headerRow = matrix[headerRowIdx];

    // columnas de día
    const dayCols = [];
    for (let c = 0; c < headerRow.length; c++) {
      if (c === metricColIdx) continue;
      const label = headerRow[c];
      if (looksLikeDayLabel(label)) dayCols.push({ c, label });
    }

    if (dayCols.length === 0) {
      throw new Error(
        "No detecté columnas de fecha/día en esa fila. " +
        "Probá cambiar 'Fila de fechas' o asegurate que el header tenga 01/02, 02/02, etc."
      );
    }

    const metricsRows = matrix.slice(headerRowIdx + 1);

    const cards = dayCols.map(({ c, label }) => {
      const metrics = [];
      for (const r of metricsRows) {
        const name = (r[metricColIdx] ?? "").trim();
        const value = (r[c] ?? "").trim();
        if (!name) continue;
        metrics.push({ name, value });
      }
      const searchBlob = (label + " " + metrics.map(m => `${m.name} ${m.value}`).join(" | ")).toLowerCase();
      return { dayLabel: label, metrics, searchBlob };
    });

    return cards;
  }

  // Render helpers
  function mkKpi(label, value) {
    const el = document.createElement("div");
    el.className = "kpi";
    el.innerHTML = `<div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div>`;
    return el;
  }

  function buildCardEl(card) {
    const el = document.createElement("article");
    el.className = "card";

    const header = document.createElement("div");
    header.className = "card-header";

    const badge = document.createElement("div");
    badge.className = "badge";
    badge.innerHTML = `<span class="dot"></span> ${escapeHtml(card.dayLabel)} · ${card.metrics.length} métricas`;

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const viewBtn = document.createElement("button");
    viewBtn.className = "icon-btn";
    viewBtn.type = "button";
    viewBtn.title = "Ver detalle";
    viewBtn.textContent = "🔎";
    viewBtn.addEventListener("click", () => openDetail(card));

    actions.appendChild(viewBtn);
    header.appendChild(badge);
    header.appendChild(actions);

    const body = document.createElement("div");
    body.className = "card-body";

    const kpiRow = document.createElement("div");
    kpiRow.className = "kpi-row";

    const nonEmpty = card.metrics.filter(m => (m.value ?? "").trim() !== "");
    kpiRow.appendChild(mkKpi("Con valor", String(nonEmpty.length)));
    kpiRow.appendChild(mkKpi("Total métricas", String(card.metrics.length)));
    kpiRow.appendChild(mkKpi("Top", nonEmpty.slice(0, 2).map(m => m.name).join(", ") || "—"));

    body.appendChild(kpiRow);

    const table = document.createElement("div");
    table.className = "table";

    card.metrics.slice(0, 10).forEach(m => {
      const r = document.createElement("div");
      r.className = "row";
      r.innerHTML =
        `<div class="key">${escapeHtml(m.name)}</div>` +
        `<div class="val">${escapeHtml(m.value || "—")}</div>`;
      table.appendChild(r);
    });

    body.appendChild(table);

    el.appendChild(header);
    el.appendChild(body);
    return el;
  }

  function renderCards() {
    cardsGrid.innerHTML = "";
    const q = (searchInput.value || "").trim().toLowerCase();

    filteredCards = !q ? dayCards : dayCards.filter(c => c.searchBlob.includes(q));

    for (const card of filteredCards) cardsGrid.appendChild(buildCardEl(card));

    showHint(
      filteredCards.length
        ? `Listo: ${filteredCards.length} tarjeta(s) (1 por día).`
        : "No hay resultados con esa búsqueda.",
      filteredCards.length ? "ok" : "warn"
    );
  }

  function openDetail(card) {
    modalTitle.textContent = `Detalle del día ${card.dayLabel}`;
    modalSubtitle.textContent = `${card.metrics.length} métricas (columna completa)`;

    modalBody.innerHTML = "";
    const table = document.createElement("div");
    table.className = "table";

    card.metrics.forEach(m => {
      const r = document.createElement("div");
      r.className = "row";
      r.innerHTML =
        `<div class="key">${escapeHtml(m.name)}</div>` +
        `<div class="val">${escapeHtml(m.value || "—")}</div>`;
      table.appendChild(r);
    });

    modalBody.appendChild(table);
    detailModal.showModal();
  }

  closeModalBtn.addEventListener("click", () => detailModal.close());
  detailModal.addEventListener("click", (e) => {
    const rect = detailModal.getBoundingClientRect();
    const inDialog =
      rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
      rect.left <= e.clientX && e.clientX <= rect.left + rect.width;
    if (!inDialog) detailModal.close();
  });

  // ==== Load logic ====
  async function load() {
    try {
      cardsGrid.innerHTML = "";
      showHint("Descargando datos del Google Sheet…", "info");

      const url = DEFAULT_SHEET_URL;
      const gid = String(gidInput.value || DEFAULT_GID).trim();
      const headerRow = Number(headerRowInput.value || DEFAULT_HEADER_ROW);
      const metricCol = Number(metricColInput.value || DEFAULT_METRIC_COL);

      const id = extractSpreadsheetId(url);
      if (!id) throw new Error("No detecté el ID del spreadsheet en la URL.");

      const csv = await fetchCsv(id, gid);
      const matrix = parseCsvToMatrix(csv);

      dayCards = buildCardsFromMatrix(matrix, headerRow, metricCol);

      showHint(`Cargado. Detecté ${dayCards.length} día(s).`, "ok");
      renderCards();
    } catch (err) {
      console.error(err);
      showHint(`Error: ${err.message}`, "danger");
    }
  }

  loadBtn.addEventListener("click", load);
  reloadBtn.addEventListener("click", load);
  searchInput.addEventListener("input", renderCards);

  // Autocarga al iniciar
  load();
})();
