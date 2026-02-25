const DOM = {
  fileInput: document.getElementById("csvFile"),
  analyzeBtn: document.getElementById("analyzeBtn"),
  demoFileBtn: document.getElementById("demoFileBtn"),
  sensitiveToggleBtn: document.getElementById("sensitiveToggle"),
  statusText: document.getElementById("status"),
  escenarioAnualInput: document.getElementById("escenarioAnual"),
  excluirList: document.getElementById("excluirList"),
  excluirSummary: document.getElementById("excluirSummary"),
  excluirDropdown: document.getElementById("excluirDropdown"),
  excluirToggle: document.getElementById("excluirToggle"),
  excluirPanel: document.getElementById("excluirPanel"),
  kpiPv: document.getElementById("kpiPv"),
  kpiCoste: document.getElementById("kpiCoste"),
  kpiMargen: document.getElementById("kpiMargen"),
  kpiRent: document.getElementById("kpiRent"),
  tableBody: document.querySelector("#resultsTable tbody"),
  globalSearchInput: document.getElementById("globalSearch"),
  pageSizeSelect: document.getElementById("pageSize"),
  prevPageBtn: document.getElementById("prevPage"),
  nextPageBtn: document.getElementById("nextPage"),
  pageInfo: document.getElementById("pageInfo"),
  filterInputs: Array.from(document.querySelectorAll("[data-filter]")),
  sortableHeaders: Array.from(document.querySelectorAll("th.sortable")),
  chartMargenCanvas: document.getElementById("chartMargen"),
  chartPvCosteCanvas: document.getElementById("chartPvCoste"),
  chartRentabilidadCanvas: document.getElementById("chartRentabilidad"),
};

const CONFIG = {
  apiUrl: (() => {
    const configuredBase = window.APP_CONFIG?.backendBaseUrl?.trim();
    if (configuredBase && !configuredBase.includes("TU-BACKEND.onrender.com")) {
      return `${configuredBase.replace(/\/$/, "")}/api/rentabilidad/analyze`;
    }
    if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") {
      return "http://127.0.0.1:8000/api/rentabilidad/analyze";
    }
    return "/api/rentabilidad/analyze";
  })(),
  demoCsvUrl: "./assets/demo_mrw_ficticio.csv",
  sensitiveMask: "******",
};

const FORMAT = {
  money: new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }),
  pct: new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  compactMoney: new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    notation: "compact",
    maximumFractionDigits: 1,
  }),
};

const state = {
  cachedFile: null,
  chartMargen: null,
  chartPvCoste: null,
  chartRentabilidad: null,
  rows: [],
  summary: null,
  currentPage: 1,
  sortKey: "margen",
  sortDir: "desc",
  columnFilters: {},
  hideSensitive: false,
};

function selectedExclusions() {
  return Array.from(DOM.excluirList.querySelectorAll("input[type='checkbox']:checked")).map(
    (checkbox) => checkbox.value
  );
}

function updateExclusionSummary() {
  const total = DOM.excluirList.querySelectorAll("input[type='checkbox']").length;
  const selected = selectedExclusions().length;
  DOM.excluirSummary.textContent =
    selected > 0 ? `Abonados excluidos: ${selected} de ${total}` : "Seleccionar abonados";
}

function setStatus(text) {
  DOM.statusText.textContent = text;
}

function setLoading(isLoading) {
  DOM.analyzeBtn.disabled = isLoading;
}

function renderExclusionList(abonados) {
  const selected = new Set(selectedExclusions());
  DOM.excluirList.innerHTML = "";

  abonados.forEach((abonado) => {
    const label = document.createElement("label");
    label.className = "excluir-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = abonado;
    checkbox.checked = selected.has(abonado);
    checkbox.addEventListener("change", () => {
      updateExclusionSummary();
      if (state.cachedFile) analyze();
    });

    const text = document.createElement("span");
    text.textContent = abonado;

    label.appendChild(checkbox);
    label.appendChild(text);
    DOM.excluirList.appendChild(label);
  });

  updateExclusionSummary();
}

function renderSummary(summary) {
  const isHidden = state.hideSensitive;
  DOM.kpiPv.textContent = isHidden ? CONFIG.sensitiveMask : FORMAT.money.format(summary.total_pv);
  DOM.kpiCoste.textContent = isHidden ? CONFIG.sensitiveMask : FORMAT.money.format(summary.total_coste);
  DOM.kpiMargen.textContent = isHidden ? CONFIG.sensitiveMask : FORMAT.money.format(summary.total_margen);
  DOM.kpiRent.textContent = isHidden
    ? CONFIG.sensitiveMask
    : `${FORMAT.pct.format(summary.rentabilidad_media_pct)} %`;
}

function destroyCharts() {
  [state.chartMargen, state.chartPvCoste, state.chartRentabilidad].forEach((chart) => {
    if (chart) chart.destroy();
  });
  state.chartMargen = null;
  state.chartPvCoste = null;
  state.chartRentabilidad = null;
}

function toKEuroTick(value) {
  const n = Number(value) || 0;
  if (Math.abs(n) < 1000) return `${Math.round(n)} €`;
  const k = n / 1000;
  const decimals = Math.abs(k) >= 10 ? 0 : 1;
  return `${k.toFixed(decimals)} k€`;
}

function moneyTooltip(value) {
  return FORMAT.money.format(value);
}

function baseChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: true,
    aspectRatio: 1.6,
    interaction: { mode: "index", intersect: false },
    layout: { padding: { right: 12, left: 4, top: 6, bottom: 0 } },
    plugins: {
      legend: {
        labels: {
          color: "#1f2c44",
          boxWidth: 14,
          font: { family: "Space Grotesk", size: 12, weight: "600" },
        },
      },
      tooltip: {
        backgroundColor: "#12233d",
        titleColor: "#ffffff",
        bodyColor: "#e8eef8",
        padding: 10,
      },
    },
    scales: {
      x: {
        grid: { color: "rgba(18,35,61,0.08)" },
        ticks: {
          color: "#3f506d",
          font: { family: "Space Grotesk", size: 11 },
          maxRotation: 0,
          minRotation: 0,
          autoSkip: true,
          maxTicksLimit: 6,
        },
      },
      y: {
        grid: { color: "rgba(18,35,61,0.08)" },
        ticks: {
          color: "#3f506d",
          font: { family: "Space Grotesk", size: 11, weight: "600" },
          autoSkip: false,
        },
      },
    },
  };
}

function buildPvCostRows(charts) {
  const names = charts.names || charts.labels.map(() => "");
  return charts.labels
    .map((label, index) => ({
      label,
      name: names[index] || "",
      pv: charts.pv[index],
      coste: charts.coste[index],
    }))
    .sort((a, b) => b.pv + b.coste - (a.pv + a.coste));
}

function renderCharts(charts) {
  destroyCharts();
  const names = charts.names || charts.labels.map(() => "");

  const margenOptions = baseChartOptions();
  margenOptions.indexAxis = "y";
  margenOptions.interaction = { mode: "nearest", axis: "y", intersect: true };
  margenOptions.plugins.tooltip.callbacks = {
    title: (items) => {
      const index = items[0].dataIndex;
      return `${charts.labels[index]} | ${names[index] || "-"}`;
    },
    label: (ctx) => `Margen: ${moneyTooltip(ctx.parsed.x)}`,
  };
  margenOptions.scales.x.ticks.callback = toKEuroTick;

  state.chartMargen = new Chart(DOM.chartMargenCanvas, {
    type: "bar",
    data: {
      labels: charts.labels,
      datasets: [
        {
          label: "Margen",
          data: charts.margenes,
          backgroundColor: "rgba(14,165,164,0.82)",
          borderRadius: 8,
          borderSkipped: false,
          maxBarThickness: 24,
        },
      ],
    },
    options: margenOptions,
  });

  const pvCostRows = buildPvCostRows(charts);
  const pvLabels = pvCostRows.map((row) => row.label);
  const pvNames = pvCostRows.map((row) => row.name);

  const pvCosteOptions = baseChartOptions();
  pvCosteOptions.indexAxis = "y";
  pvCosteOptions.interaction = { mode: "index", axis: "y", intersect: false };
  pvCosteOptions.plugins.tooltip.mode = "index";
  pvCosteOptions.plugins.tooltip.intersect = false;
  pvCosteOptions.plugins.tooltip.callbacks = {
    title: (items) => {
      const index = items[0].dataIndex;
      return `${pvLabels[index]} | ${pvNames[index] || "-"}`;
    },
    label: (ctx) => `${ctx.dataset.label}: ${moneyTooltip(ctx.parsed.x)}`,
  };
  pvCosteOptions.scales.x.ticks.callback = toKEuroTick;

  state.chartPvCoste = new Chart(DOM.chartPvCosteCanvas, {
    type: "bar",
    data: {
      labels: pvLabels,
      datasets: [
        {
          label: "PV",
          data: pvCostRows.map((row) => row.pv),
          backgroundColor: "rgba(15,76,129,0.85)",
          borderRadius: 8,
          borderSkipped: false,
          maxBarThickness: 16,
        },
        {
          label: "Coste",
          data: pvCostRows.map((row) => row.coste),
          backgroundColor: "rgba(239,68,68,0.82)",
          borderRadius: 8,
          borderSkipped: false,
          maxBarThickness: 16,
        },
      ],
    },
    options: pvCosteOptions,
  });

  const rentOptions = baseChartOptions();
  rentOptions.plugins.tooltip.callbacks = {
    title: (items) => {
      const index = items[0].dataIndex;
      return `${charts.labels[index]} | ${names[index] || "-"}`;
    },
    label: (ctx) => `Rentabilidad: ${FORMAT.pct.format(ctx.parsed.y)} %`,
  };
  rentOptions.scales.y.ticks.callback = (value) => `${FORMAT.pct.format(value)} %`;

  state.chartRentabilidad = new Chart(DOM.chartRentabilidadCanvas, {
    type: "line",
    data: {
      labels: charts.labels,
      datasets: [
        {
          label: "Rentabilidad %",
          data: charts.rentabilidad_pct,
          borderColor: "#0ea5a4",
          backgroundColor: "rgba(14,165,164,.15)",
          pointBackgroundColor: "#0f4c81",
          pointRadius: 3,
          fill: true,
          tension: 0.25,
        },
      ],
    },
    options: rentOptions,
  });
}

function applyTableFiltersAndSort(rows) {
  const globalSearch = DOM.globalSearchInput.value.trim().toLowerCase();

  const filteredRows = rows.filter((row) => {
    if (globalSearch) {
      const haystack = `${row.abonado} ${row.razon_social} ${row.pv} ${row.coste} ${row.margen} ${row.rentabilidad_pct}`.toLowerCase();
      if (!haystack.includes(globalSearch)) return false;
    }

    for (const [key, value] of Object.entries(state.columnFilters)) {
      if (!value) continue;
      const cell = String(row[key] ?? "").toLowerCase();
      if (!cell.includes(value)) return false;
    }
    return true;
  });

  filteredRows.sort((a, b) => {
    const av = a[state.sortKey];
    const bv = b[state.sortKey];

    if (typeof av === "number" && typeof bv === "number") {
      return state.sortDir === "asc" ? av - bv : bv - av;
    }
    const cmp = String(av).localeCompare(String(bv), "es", { sensitivity: "base" });
    return state.sortDir === "asc" ? cmp : -cmp;
  });

  return filteredRows;
}

function renderTablePage() {
  const filteredRows = applyTableFiltersAndSort(state.rows);
  const pageSize = Number(DOM.pageSizeSelect.value);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  if (state.currentPage > totalPages) state.currentPage = totalPages;

  const start = (state.currentPage - 1) * pageSize;
  const pageRows = filteredRows.slice(start, start + pageSize);

  DOM.tableBody.innerHTML = "";
  pageRows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.abonado}</td>
      <td>${row.razon_social}</td>
      <td>${FORMAT.money.format(row.pv)}</td>
      <td>${FORMAT.money.format(row.coste)}</td>
      <td>${FORMAT.money.format(row.margen)}</td>
      <td>${FORMAT.pct.format(row.rentabilidad_pct)} %</td>
    `;
    DOM.tableBody.appendChild(tr);
  });

  DOM.pageInfo.textContent = `Pagina ${state.currentPage} de ${totalPages} (${filteredRows.length} filas)`;
  DOM.prevPageBtn.disabled = state.currentPage <= 1;
  DOM.nextPageBtn.disabled = state.currentPage >= totalPages;
}

function setExclusionPanelOpen(isOpen) {
  DOM.excluirPanel.hidden = !isOpen;
  DOM.excluirDropdown.classList.toggle("open", isOpen);
}

function onAnalyzeSuccess(payload) {
  renderExclusionList(payload.all_abonados);

  state.summary = payload.summary;
  renderSummary(payload.summary);

  state.rows = payload.rows;
  state.currentPage = 1;
  renderTablePage();
  renderCharts(payload.charts);
  setStatus(`Analisis completado. ${payload.rows.length} abonados mostrados.`);
}

function buildAnalyzeFormData() {
  const formData = new FormData();
  formData.append("csv_file", state.cachedFile);
  formData.append("escenario_anual", String(DOM.escenarioAnualInput.checked));
  formData.append("excluir", selectedExclusions().join(","));
  return formData;
}

async function parseApiResponse(res) {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return await res.json();
  }

  const text = await res.text();
  const preview = text.slice(0, 180).replace(/\s+/g, " ").trim();
  throw new Error(
    `Respuesta no valida del backend (${res.status}). Revisa APP_CONFIG.backendBaseUrl. Recibido: ${preview}`
  );
}

async function analyze() {
  if (!state.cachedFile) {
    setStatus("Selecciona primero un archivo CSV.");
    return;
  }

  setLoading(true);
  setStatus("Analizando...");

  try {
    const res = await fetch(CONFIG.apiUrl, {
      method: "POST",
      body: buildAnalyzeFormData(),
    });
    const payload = await parseApiResponse(res);
    if (!res.ok) throw new Error(payload.detail || "Error inesperado.");
    onAnalyzeSuccess(payload);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    setLoading(false);
  }
}

async function loadDemoFile() {
  DOM.demoFileBtn.disabled = true;
  setStatus("Cargando fichero de prueba...");
  try {
    const res = await fetch(CONFIG.demoCsvUrl);
    if (!res.ok) throw new Error("No se pudo cargar el CSV de prueba.");
    const blob = await res.blob();
    state.cachedFile = new File([blob], "demo_mrw_ficticio.csv", { type: "text/csv" });
    setStatus("Fichero de prueba cargado. Analizando demo...");
    await analyze();
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    DOM.demoFileBtn.disabled = false;
  }
}

function setupTableControls() {
  DOM.globalSearchInput.addEventListener("input", () => {
    state.currentPage = 1;
    renderTablePage();
  });

  DOM.pageSizeSelect.addEventListener("change", () => {
    state.currentPage = 1;
    renderTablePage();
  });

  DOM.prevPageBtn.addEventListener("click", () => {
    if (state.currentPage <= 1) return;
    state.currentPage -= 1;
    renderTablePage();
  });

  DOM.nextPageBtn.addEventListener("click", () => {
    state.currentPage += 1;
    renderTablePage();
  });

  DOM.filterInputs.forEach((input) => {
    const key = input.dataset.filter;
    input.addEventListener("input", () => {
      state.columnFilters[key] = input.value.trim().toLowerCase();
      state.currentPage = 1;
      renderTablePage();
    });
  });

  DOM.sortableHeaders.forEach((header) => {
    const key = header.dataset.key;
    header.addEventListener("click", () => {
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = key;
        state.sortDir = key === "abonado" || key === "razon_social" ? "asc" : "desc";
      }
      renderTablePage();
    });
  });
}

function setupSensitiveToggle() {
  DOM.sensitiveToggleBtn.addEventListener("click", () => {
    state.hideSensitive = !state.hideSensitive;
    document.body.classList.toggle("hide-sensitive", state.hideSensitive);
    DOM.sensitiveToggleBtn.textContent = state.hideSensitive
      ? "Mostrar datos sensibles"
      : "Ocultar datos sensibles";
    if (state.summary) renderSummary(state.summary);
  });
}

function setupExclusionDropdown() {
  DOM.excluirToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    setExclusionPanelOpen(DOM.excluirPanel.hidden);
  });

  document.addEventListener("click", (event) => {
    if (!DOM.excluirDropdown.contains(event.target)) {
      setExclusionPanelOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setExclusionPanelOpen(false);
    }
  });
}

function setupBaseEvents() {
  DOM.fileInput.addEventListener("change", () => {
    state.cachedFile = DOM.fileInput.files[0] || null;
  });
  DOM.analyzeBtn.addEventListener("click", analyze);
  DOM.demoFileBtn.addEventListener("click", loadDemoFile);
  DOM.escenarioAnualInput.addEventListener("change", () => {
    if (state.cachedFile) analyze();
  });
}

function init() {
  setupBaseEvents();
  setupTableControls();
  setupSensitiveToggle();
  setupExclusionDropdown();
  updateExclusionSummary();
}

init();
