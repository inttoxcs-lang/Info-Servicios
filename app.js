(() => {
  // =========================
  // CONFIG – TU GOOGLE SHEET
  // =========================
  const SHEET_URL =
    "https://docs.google.com/spreadsheets/d/120WSaF1Zu6h4-Edid-Yc7GIWKwtQB61GQ3rNexH-MXc/edit?gid=0#gid=0";

  const DEFAULT_GID = "0";
  const DEFAULT_HEADER_ROW = 1; // fila donde están las fechas (1-based)
  const DEFAULT_METRIC_COL = 1; // columna métricas (A=1)

  // =========================
  // DOM
  // =========================
  const sheetUrlInput = document.getElementById("sheetUrl");
  const gidInput = document.getElementById("gidInput");
  const headerRowInput = document.getElementById("headerRowInput");
  const metricColInput = document.getElementById("metricColInput");
  const reloadBtn = document.getElementById("reloadBtn");
  const applyBtn = document.getElementById("applyBtn");
  const openSheetBtn = document.getElementById("openSheetBtn");
  const searchInput = document.getElementById("searchInput");
  const cardsGrid = document.getElementById("cardsGrid");
  const hint = document.getElementById("hint");

  const detailModal = document.getElementById("detailModal");
  const closeModalBtn = document.getElementById("closeModalBtn");
  const modalTitle = document.getElementById("modalTitle");
  const modalSubtitle = document.getElementById("modalSubtitle");
  const modalBody = document.getElementById("modalBody");

  // =========================
  // STATE
  // =========================
  let dayCards = [];
  let filteredCards = [];

  // =========================
  // INIT UI
  // =========================
  sheetUrlInput.value = SHEET_URL;
  gidInput.value = DEFAULT_GID;
  headerRowInput.value = DEFAULT_HEADER_ROW;
  metricColInput.value = DEFAULT_METRIC_COL;

  openSheetBtn.addEventListener("click", () => {
    window.open(SHEET_URL, "_blank", "noopener,noreferrer");
  });

  // =========================
  // HELPERS
  // =========================
  function showHint(text, tone = "info") {
    const colors = {
      info: "rgba(255,255,255,0.68)",
      warn: "rgba(245,158,11,0.95)",
      danger: "rgba(239,68,68,0.95)",
      ok: "rgba(34,197,94,0.95)",
    };
    hint.textContent = text;
    hint.style.color = colors[tone] || colors.info;
  }

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

  // =========================
  // FETCH CSV (CORREGIDO)
  // =========================
  async function fetchCsv(spreadsheetId, gid) {
    const csvUrl =
      `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
        spreadsheetId
      )}/export?format=csv&gid=${encodeURIComponent(gid)}`;

    const res = await fetch(csvUrl, { cache: "no-store" });
    const contentType = res.headers.get("content-type") || "";
    const text = await res.text();

    // DEBUG CLARO (mirar en F12 → Console)
    console.log("CSV URL:", csvUrl);
    console.log("HTTP:", res.status, res.statusText);
    console.log("Content-Type:", contentType);
    console.log("Preview:", text.slice(0, 300));

    if (!res.ok) {
      throw new Error(
        `HTTP ${res.status}. El Sheet no es accesible públicamente.`
      );
    }

    // Google devolvió HTML → login / permisos
    if (
      contentType.includes("text/html") ||
      text.trim().startsWith("<") ||
      text.includes("<html")
    ) {
      throw new Error(
        "Google devolvió HTML (login/permisos). " +
        "Tenés que ir a Google Sheets → Archivo → Publicar en la web."
      );
    }

    return text; // CSV REAL
  }

  // =========================
  // CSV → MATRIZ
  // =========================
  function parseCsvToMatrix(text) {
    const rows = [];
    let cur = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];

      if (ch === '"' && inQuotes && next === '"') {
        field += '"';
        i++;
        continue;
      }
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }

      if (!inQuotes && ch === ",") {
        cur.push(field);
        field = "";
        continue;
      }
      if (!inQuotes && ch === "\n") {
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = "";
        continue;
      }
      if (ch !== "\r") field += ch;
    }

    cur.push(field);
    rows.push(cur);

    return rows.map((r) => r.map((c) => String(c ?? "").trim()));
  }

  function looksLikeDayLabel(s) {
    if (!s) return false;
    return (
      /^\d{1,2}\/\d{1,2}$/.test(s) ||
      /^\d{1,2}-\d{1,2}$/.test(s) ||
      /^\d{4}-\d{2}-\d{2}$/.test(s) ||
      /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)
    );
  }

  function buildCardsFromMatrix(matrix, headerRow1, metricCol1) {
    const h = headerRow1 - 1;
    const m = metricCol1 - 1;

    const header = matrix[h];
    if (!header) throw new Error("Fila de fechas inexistente.");

    const dayCols = [];
    header.forEach((label, c) => {
      if (c !== m && looksLikeDayLabel(label)) {
        dayCols.push({ c, label });
      }
    });

    if (!dayCols.length) {
      throw new Error("No se detectaron columnas de fecha/día.");
    }

    const rows = matrix.slice(h + 1);

    return dayCols.map(({ c, label }) => {
      const metrics = [];
      rows.forEach((r) => {
        const name = (r[m] ?? "").trim();
        if (!name) return;
        metrics.push({
          name,
          value: (r[c] ?? "").trim(),
        });
      });

      return {
        dayLabel: label,
        metrics,
        searchBlob: (
          label +
          " " +
          metrics.map((x) => `${x.name} ${x.value}`).join(" ")
        ).toLowerCase(),
      };
    });
  }

  // =========================
  // RENDER
  // =========================
  function buildCard(card) {
    const el = document.createElement("article");
    el.className = "card";

    el.innerHTML = `
      <div class="card-header">
        <div class="badge"><span class="dot"></span>${escapeHtml(
          card.dayLabel
        )} · ${card.metrics.length} métricas</div>
        <div class="card-actions">
          <button class="icon-btn">🔎</button>
        </div>
      </div>
      <div class="card-body">
        <div class="table">
          ${card.metrics
            .slice(0, 10)
            .map(
              (m) => `
              <div class="row">
                <div class="key">${escapeHtml(m.name)}</div>
                <div class="val">${escapeHtml(m.value || "—")}</div>
              </div>`
            )
            .join("")}
        </div>
      </div>
    `;

    el.querySelector(".icon-btn").onclick = () => openDetail(card);
    return el;
  }

  function renderCards() {
    cardsGrid.innerHTML = "";
    const q = searchInput.value.trim().toLowerCase();
    filteredCards = !q
      ? dayCards
      : dayCards.filter((c) => c.searchBlob.includes(q));

    filteredCards.forEach((c) => cardsGrid.appendChild(buildCard(c)));

    showHint(
      filteredCards.length
        ? `Mostrando ${filteredCards.length} día(s).`
        : "No hay resultados.",
      filteredCards.length ? "ok" : "warn"
    );
  }

  function openDetail(card) {
    modalTitle.textContent = `Detalle ${card.dayLabel}`;
    modalSubtitle.textContent = `${card.metrics.length} métricas`;
    modalBody.innerHTML = `
      <div class="table">
        ${card.metrics
          .map(
            (m) => `
          <div class="row">
            <div class="key">${escapeHtml(m.name)}</div>
            <div class="val">${escapeHtml(m.value || "—")}</div>
          </div>`
          )
          .join("")}
      </div>
    `;
    detailModal.showModal();
  }

  closeModalBtn.onclick = () => detailModal.close();

  // =========================
  // LOAD
  // =========================
  async function load() {
    try {
      showHint("Cargando datos del Google Sheet…", "info");
      cardsGrid.innerHTML = "";

      const id = extractSpreadsheetId(SHEET_URL);
      const csv = await fetchCsv(id, gidInput.value);
      const matrix = parseCsvToMatrix(csv);

      dayCards = buildCardsFromMatrix(
        matrix,
        Number(headerRowInput.value),
        Number(metricColInput.value)
      );

      renderCards();
    } catch (err) {
      console.error(err);
      showHint(err.message, "danger");
    }
  }

  reloadBtn.onclick = load;
  applyBtn.onclick = load;
  searchInput.oninput = renderCards;

  // AUTOCARGA
  load();
})();
