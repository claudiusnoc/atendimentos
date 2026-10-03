const keys = ["site", "priority", "quantity", "technician", "base", "failure", "status", "notes", "voltage"];
const storageKey = "atendimentos.grid.v4";
const authRecoveryRequested = new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery";
const cloudConfig = window.ATENDIMENTOS_SUPABASE;
const cloudOptions = window.ATENDIMENTOS_OPTIONS;
const cloudRequested = Boolean(cloudConfig?.url && cloudConfig?.key);
const cloudClient = cloudConfig?.url && cloudConfig?.key && window.supabase?.createClient
  ? window.supabase.createClient(cloudConfig.url, cloudConfig.key, { auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true } })
  : null;
const reportCacheKey = cloudClient ? "atendimentos.cloud.grid.v1" : storageKey;
const body = document.querySelector("#records");
const template = document.querySelector("#row-template");
const note = document.querySelector("#source-note");
const siteSuggestions = new WeakMap();
const siteSuggestionTimers = new WeakMap();
const siteSuggestionRequests = new WeakMap();
let records = [];
let failureChoices = [];
let statusChoices = [];
let technicianBases = {};
let technicianChoices = [];
let sortState = { key: "", direction: 1 };
let cloudUser = null;
let cloudSaveTimer = 0;
let cloudSaveRunning = false;
let cloudSaveAgain = false;
let cloudRefreshRunning = false;
let cloudLoaded = false;
let lastGridEditAt = 0;
let cloudPollTimer = 0;
let cloudBaseline = new Map();
let observedRows = new Map();
let pendingChanges = new Map();
let syncConflict = null;
let sessionGeneration = 0;
let editProblem = false;
const syncTabId = (() => {
  try {
    const id = sessionStorage.getItem('atendimentos.tab') || crypto.randomUUID();
    sessionStorage.setItem('atendimentos.tab', id); return id;
  } catch { return crypto.randomUUID(); }
})();
const draftKey = () => `${reportCacheKey}.${cloudUser?.id}.${syncTabId}.pending.v2`;
const cacheKey = () => `${reportCacheKey}.${cloudUser?.id}.confirmed.v2`;
function persistDraft() {
  if (!cloudUser) return;
  try { localStorage.setItem(draftKey(), JSON.stringify([...pendingChanges])); }
  catch { setSyncStatus('Cache indisponível. Mantenha a página aberta até confirmar o salvamento.', 'error'); }
}
const displayCloudRow = row => ({ ...row, voltage: row.voltage == null ? '' : String(row.voltage).replace('.', ',') });
function rememberScreen() {
  observedRows = new Map([...body.rows].map((row, index) => {
    const record = read(row);
    return [record.id, ReportSync.payload(record, Number(row.dataset.order) || index + 1)];
  }));
}
function acceptCloudRows(rows) {
  cloudBaseline = new Map(rows.map(row => [row.id, { ...row }]));
  window.reportDashboard?.confirmed(rows);
  const displayed = new Map(rows.map(row => [row.id, { ...row }]));
  for (const [id, operation] of pendingChanges) {
    if (operation.deleted) displayed.delete(id);
    else displayed.set(id, { ...(displayed.get(id) || operation.base || {}), ...operation.patch, id });
  }
  const visible = [...displayed.values()].sort((a, b) => a.ordem - b.ordem);
  cellOptions.close(); body.replaceChildren();
  addRows(visible.length ? visible.map(displayCloudRow) : [{}]);
  records = [...body.rows].map(read); rememberScreen(); applySearch();
  try { localStorage.setItem(cacheKey(), JSON.stringify(rows)); } catch { /* Network remains authoritative. */ }
}

function setSyncStatus(message, state = "neutral") {
  note.textContent = message;
  note.dataset.sync = state;
  window.reportDashboard?.sync(message, state);
  const resolve = document.querySelector('#resolve-conflict');
  if (resolve) resolve.hidden = !syncConflict;
}

const fields = (row) => ({
  site: row.querySelector(".site-input"), priority: row.querySelector(".priority-input"), quantity: row.querySelector(".quantity-input"),
  technician: row.querySelector(".technician-input"), base: row.querySelector(".base-input"), failure: row.querySelector(".failure-input"),
  status: row.querySelector(".status-input"), notes: row.querySelector(".notes-input"), voltage: row.querySelector(".voltage-input")
});
const normalizeSite = (value) => value.toUpperCase().replace(/\s/g, "");
const technicianToken = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const priorityToken = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, "-");
const paintPriority = (input) => { input.dataset.priority = priorityToken(input.value); };
const statusToken = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const paintStatus = (input) => { input.dataset.status = statusToken(input.value); };
const paintFailure = (input) => { input.dataset.failure = statusToken(input.value); };
const paintVoltage = (input) => {
  const text = input.value.trim().replace(/\s*v$/i, "").replace(",", ".");
  const value = text && /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
  const band = Number.isNaN(value) ? "" : value >= 53 ? "green" : value >= 49 ? "blue" : value >= 45 ? "yellow" : "red";
  input.dataset.voltage = band;
  const detail = Number.isNaN(value)
    ? "Tensão em volts"
    : value < 42
      ? "Condição extrema"
      : value < 43
        ? "Risco muito alto de desligamento"
        : value < 44
          ? "Possível atuação do LVD"
          : value < 45
            ? "Tensão crítica"
            : value < 49
              ? "Atenção"
              : value < 53
                ? "Faixa azul"
                : "Faixa verde";
  input.title = Number.isNaN(value) ? detail : `${value.toLocaleString("pt-BR")} V · ${detail}`;
  input.setAttribute("aria-description", Number.isNaN(value) ? detail : `${value.toLocaleString("pt-BR")} volts. ${detail}.`);
};
async function getCloudRows() {
  const { data, error } = await cloudClient.from("atendimentos")
    .select(ReportSync.select)
    .order("ordem").order("created_at");
  if (error) throw error;
  return data || [];
}
const request = async (url) => {
  if (!cloudClient) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Não foi possível consultar a referência.");
    return response.json();
  }
  if (url === "/api/options") return cloudOptions;
  if (url === "/api/health") return { source: "Supabase", reportSourceAvailable: true };
  if (url === "/api/report") return { rows: await getCloudRows() };
  if (url.startsWith("/api/sites?q=")) {
    const query = new URL(url, location.origin).searchParams.get("q")?.trim().toUpperCase();
    if (!query) return { items: [] };
    const { data, error } = await cloudClient.from("tipologia_sites").select("site").ilike("site", `%${query}%`).order("site").limit(16);
    if (error) throw error;
    return { items: (data || []).map((row) => row.site) };
  }
  if (url.startsWith("/api/sites/")) {
    const siteCode = decodeURIComponent(url.split("/").at(-1));
    const { data, error } = await cloudClient.from("tipologia_sites").select("site,priority,quantity,dados").eq("site", siteCode).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Estação não localizada na Tipologia.");
    return data;
  }
  throw new Error("Consulta não reconhecida.");
};
const save = () => {
  if (!cloudClient) try { localStorage.setItem(reportCacheKey, JSON.stringify(records)); } catch { /* Local mode only. */ }
  if (cloudClient && cloudUser) {
    window.clearTimeout(cloudSaveTimer);
    cloudSaveTimer = 0;
    if (pendingChanges.size && !syncConflict) {
      setSyncStatus('Alterações pendentes de envio…', 'pending');
      cloudSaveTimer = window.setTimeout(() => { cloudSaveTimer = 0; saveCloudRows(); }, 450);
    }
  }
};
const read = (row) => ({ ...Object.fromEntries(Object.entries(fields(row)).map(([key, element]) => [key, element.value.trim()])), id: row.dataset.recordId || "" });
const updateCount = () => {
  window.reportDashboard?.update([...body.rows].filter(row => row.dataset.validSite === 'true').map(read));
  applySearch();
};
const sync = () => {
  lastGridEditAt = Date.now(); records = [...body.rows].map(read); editProblem = false;
  if (cloudClient && cloudUser) {
    for (const [index, row] of [...body.rows].entries()) {
      const record = read(row);
      try {
        const value = ReportSync.payload(record, Number(row.dataset.order) || index + 1);
        const previous = observedRows.get(record.id) || {};
        const changed = Object.fromEntries(Object.entries(value).filter(([key, val]) => !ReportSync.equal(previous[key], val)));
        if (Object.keys(changed).length && (record.site || cloudBaseline.has(record.id))) {
          const existing = pendingChanges.get(record.id);
          const base = existing ? existing.base : cloudBaseline.get(record.id) || null;
          pendingChanges.set(record.id, { id: record.id, base, patch: base ? { ...(existing?.patch || {}), ...changed } : value, valid: row.dataset.validSite === 'true' });
        }
        const operation = pendingChanges.get(record.id);
        if (operation) operation.valid = row.dataset.validSite === 'true';
        observedRows.set(record.id, value);
      } catch (error) { editProblem = true; setSyncStatus(error.message, 'error'); }
    }
    persistDraft();
  }
  save(); updateCount();
};
const priorityRank = (value) => {
  const match = priorityToken(value).match(/(?:nivel-*)?(\d+)/i);
  if (match) return Number(match[1]);
  return value.toLocaleLowerCase("pt-BR").includes("implant") ? 6 : 99;
};
const quantityRank = (value) => {
  const match = value.replace(",", ".").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
};
function sortableValue(record, key) {
  if (key === "priority") return priorityRank(record[key] || "");
  if (key === "quantity") return quantityRank(record[key] || "");
  return (record[key] || "").toLocaleLowerCase("pt-BR");
}
function applySearch() {
  const query = document.querySelector("#search").value.toLocaleLowerCase("pt-BR");
  [...body.rows].forEach((row) => { const record = read(row); row.hidden = !Object.values(record).join(" ").toLocaleLowerCase("pt-BR").includes(query) || (window.reportDashboard && !window.reportDashboard.matches(record)); });
  window.reportDashboard?.visible([...body.rows].filter(row => !row.hidden && row.dataset.validSite === 'true').length);
}
function updateSortIndicators() {
  document.querySelectorAll(".sort-button").forEach((button) => {
    const active = sortState.key === button.dataset.sortKey;
    button.dataset.direction = active ? (sortState.direction === 1 ? "asc" : "desc") : "";
    button.setAttribute("aria-pressed", String(active));
    button.closest("th").setAttribute("aria-sort", active ? (sortState.direction === 1 ? "ascending" : "descending") : "none");
    const name = button.querySelector(".column-label > span").textContent.toLocaleLowerCase("pt-BR");
    button.title = `Classificar por ${name}: ${active && sortState.direction === 1 ? "decrescente" : "crescente"}`;
    const icon = button.querySelector(".sort-icon");
    icon.innerHTML = active ? '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10 3v14m-5-5 5 5 5-5"/></svg>' : '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m6 7 4-4 4 4M6 13l4 4 4-4"/></svg>';
    if (active) document.querySelector("#sort-summary").textContent = `${name.charAt(0).toUpperCase() + name.slice(1)} · ${sortState.direction === 1 ? "crescente" : "decrescente"}`;
  });
}
function sortRows(key) {
  sortState = sortState.key === key ? { key, direction: sortState.direction * -1 } : { key, direction: 1 };
  const sorted = [...body.rows].sort((leftRow, rightRow) => {
    const left = read(leftRow);
    const right = read(rightRow);
    const leftValue = sortableValue(left, key);
    const rightValue = sortableValue(right, key);
    const leftEmpty = !String(left[key] || "").trim();
    const rightEmpty = !String(right[key] || "").trim();
    if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
    if (leftValue === rightValue) return 0;
    const result = typeof leftValue === "number" && typeof rightValue === "number" ? leftValue - rightValue : String(leftValue).localeCompare(String(rightValue), "pt-BR", { numeric: true, sensitivity: "base" });
    return sortState.direction * result;
  });
  cellOptions.close();
  body.replaceChildren(...sorted);
  [...body.rows].forEach((row, index) => { row.dataset.order = index + 1; });
  sync();
  applySearch();
  updateSortIndicators();
}

async function saveCloudRows() {
  if (!cloudClient || !cloudUser) return;
  window.clearTimeout(cloudSaveTimer); cloudSaveTimer = 0;
  if (cloudSaveRunning) { cloudSaveAgain = true; return; }
  if (syncConflict || !pendingChanges.size) return;
  cloudSaveRunning = true;
  const generation = sessionGeneration;
  try {
    setSyncStatus('Salvando no Supabase…', 'pending');
    for (const [id, operation] of [...pendingChanges]) {
      if (generation !== sessionGeneration) return;
      if (!operation.deleted && !operation.valid) continue;
      const sent = structuredClone(operation);
      const saved = await ReportSync.commit(cloudClient, sent);
      if (generation !== sessionGeneration) return;
      if (saved) cloudBaseline.set(id, saved); else cloudBaseline.delete(id);
      window.reportDashboard?.confirmed([...cloudBaseline.values()]);
      const latest = pendingChanges.get(id);
      if (latest) {
        const remaining = Object.fromEntries(Object.entries(latest.patch).filter(([key, val]) => !ReportSync.equal(sent.patch[key], val)));
        if (Object.keys(remaining).length || latest.deleted !== sent.deleted) {
          pendingChanges.set(id, { ...latest, base: saved, patch: remaining }); cloudSaveAgain = true;
        } else pendingChanges.delete(id);
      }
      persistDraft();
    }
    setSyncStatus(pendingChanges.size || editProblem ? 'Há campos pendentes. Confira a estação e a tensão antes de sair.' : 'Alterações salvas no Supabase.', pendingChanges.size || editProblem ? 'error' : 'saved');
  } catch (error) {
    if (error.name === 'SyncConflict') syncConflict = error;
    setSyncStatus(`${syncConflict ? 'Conflito entre dispositivos' : 'Falha ao salvar na nuvem'}: ${error.message || 'Verifique a conexão.'} Sua edição permanece neste navegador.`, 'error');
  } finally {
    cloudSaveRunning = false;
    if (cloudSaveAgain && !syncConflict) { cloudSaveAgain = false; saveCloudRows(); }
  }
}

function deleteCloudRow(id) {
  if (!id || !cloudClient || !cloudUser) return;
  const existing = pendingChanges.get(id);
  const base = existing?.base || cloudBaseline.get(id);
  if (!base && !cloudSaveRunning) pendingChanges.delete(id);
  else pendingChanges.set(id, { id, base: base || null, patch: existing?.patch || {}, deleted: true });
  observedRows.delete(id); persistDraft();
}

function suggestSites(input) {
  const query = normalizeSite(input.value);
  const oldTimer = siteSuggestionTimers.get(input);
  if (oldTimer) window.clearTimeout(oldTimer);
  const requestId = (siteSuggestionRequests.get(input) || 0) + 1;
  siteSuggestionRequests.set(input, requestId);
  if (!query) {
    siteSuggestions.set(input, []);
    cellOptions.setEmptyMessage(input, "");
    cellOptions.refresh(input);
    return;
  }
  cellOptions.setEmptyMessage(input, "");
  const timer = window.setTimeout(async () => {
    try {
      const result = await request(`/api/sites?q=${encodeURIComponent(query)}`);
      if (siteSuggestionRequests.get(input) !== requestId || normalizeSite(input.value) !== query) return;
      siteSuggestions.set(input, (result.items || []).map(site => ({ value: site, label: site })));
      cellOptions.setEmptyMessage(input, "");
      cellOptions.refresh(input);
    } catch {
      if (siteSuggestionRequests.get(input) !== requestId) return;
      siteSuggestions.set(input, []);
      cellOptions.setEmptyMessage(input, "Falha ao consultar a Tipologia. Confira a conexão e tente novamente.");
    }
  }, 180);
  siteSuggestionTimers.set(input, timer);
}
function createRow(record = {}) {
  const fragment = template.content.cloneNode(true);
  const row = fragment.querySelector("tr");
  if (cloudClient || record.id) row.dataset.recordId = record.id || crypto.randomUUID();
  row.dataset.order = record.ordem || Math.max(0, ...[...body.rows].map(item => Number(item.dataset.order) || 0)) + 1;
  if (record.site) row.dataset.validSite = "true";
  // Replace native selects with the same styled combobox used by technicians.
  row.querySelectorAll("select").forEach((select) => {
    const input = document.createElement("textarea");
    input.rows = 1;
    input.className = select.className;
    input.setAttribute("aria-label", select.getAttribute("aria-label"));
    input.autocomplete = "off";
    select.replaceWith(input);
  });
  const oldNotes = row.querySelector('.notes-input');
  const notesArea = document.createElement('textarea');
  notesArea.className = oldNotes.className; notesArea.rows = 1;
  notesArea.setAttribute('aria-label', 'Observação');
  oldNotes.replaceWith(notesArea);
  const rowFields = fields(row);
  Object.entries(rowFields).forEach(([key, input]) => {
    const paint = () => { if (key === "priority") paintPriority(input); if (key === "status") paintStatus(input); if (key === "failure") paintFailure(input); if (key === "voltage") paintVoltage(input); };
    const value = key === "technician" && record[key] === "APOIO OS" ? "APOIO OESTE" : String(record[key] || "");
    input.value = key === "voltage" ? value.trim().replace(/\s*v$/i, "").replace(".", ",") : value;
    paint();
    if (key === 'notes') input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); input.blur(); } });
    ["input", "change"].forEach((event) => input.addEventListener(event, () => {
      if (key === 'site') row.dataset.validSite = '';
      if (key === 'technician') rowFields.base.value = technicianBases[technicianToken(input.value)] || '';
      paint(); sync();
    }));
    if (key === "voltage") input.addEventListener("blur", () => {
      const numeric = input.value.trim().replace(/\s*v$/i, "");
      if (/^\d+(?:[.,]\d+)?$/.test(numeric)) input.value = numeric.replace(".", ",");
      paintVoltage(input);
      sync();
    });
  });
  cellOptions.attach(rowFields.technician, () => technicianChoices, { freeText: true });
  cellOptions.attach(rowFields.failure, () => failureChoices);
  cellOptions.attach(rowFields.status, () => statusChoices, { kind: "status" });
  let siteLookupSequence = 0;
  siteSuggestions.set(rowFields.site, []);
  cellOptions.attach(rowFields.site, () => siteSuggestions.get(rowFields.site) || [], {
    freeText: true,
    openOnClick: false,
    enterSelectFirst: true,
    onInput: () => suggestSites(rowFields.site)
  });
  rowFields.site.addEventListener("input", () => {
    rowFields.site.value = normalizeSite(rowFields.site.value);
    row.dataset.validSite = "";
    siteLookupSequence++;
    if (normalizeSite(rowFields.site.value) !== row.dataset.resolvedSite) {
      rowFields.priority.value = "";
      rowFields.quantity.value = "";
      paintPriority(rowFields.priority);
    }
    if (!rowFields.site.value.trim()) {
      row.dataset.resolvedSite = "";
      siteSuggestions.set(rowFields.site, []);
    }
  });
  rowFields.site.addEventListener("change", async () => {
    const code = normalizeSite(rowFields.site.value);
    const lookupSequence = ++siteLookupSequence;
    rowFields.site.value = code;
    siteSuggestions.set(rowFields.site, []);
    cellOptions.close();
    if (!code) {
      row.dataset.validSite = "";
      row.dataset.resolvedSite = "";
      rowFields.priority.value = "";
      rowFields.quantity.value = "";
      paintPriority(rowFields.priority);
      sync();
      return;
    }
    if (code !== row.dataset.resolvedSite) {
      rowFields.priority.value = "";
      rowFields.quantity.value = "";
      paintPriority(rowFields.priority);
    }
    try {
      const site = await request(`/api/sites/${encodeURIComponent(code)}`);
      if (lookupSequence !== siteLookupSequence || normalizeSite(rowFields.site.value) !== code || !row.isConnected) return;
      row.dataset.validSite = "true";
      row.dataset.resolvedSite = code;
      rowFields.priority.value = site.priority || "";
      paintPriority(rowFields.priority);
      rowFields.quantity.value = site.quantity || "";
      note.textContent = `${code}: referências da Tipologia aplicadas à linha.`;
    } catch {
      if (lookupSequence !== siteLookupSequence || normalizeSite(rowFields.site.value) !== code || !row.isConnected) return;
      row.dataset.validSite = "";
      row.dataset.resolvedSite = "";
      rowFields.priority.value = "";
      rowFields.quantity.value = "";
      paintPriority(rowFields.priority);
      note.textContent = "Estação não localizada na Tipologia. Confira a sigla digitada.";
    }
    sync();
  });
  const removeButton = row.querySelector(".remove-button");
  removeButton.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="m7 7 10 10M17 7 7 17"/></svg>';
  removeButton.title = "Remover linha";
  removeButton.addEventListener("click", () => { deleteCloudRow(row.dataset.recordId); row.remove(); sync(); });
  body.append(fragment);
}
function addRows(items) { items.forEach(createRow); updateCount(); }
function exportCsv() {
  const lines = [...body.rows].map(read).filter((row) => Object.values(row).some(Boolean));
  if (!lines.length) { note.textContent = "Inclua ao menos uma instalação antes de exportar."; return; }
  const headers = ["ESTAÇÃO", "PRIORIDADE", "ESTAÇÕES QUE CARREGA", "TÉCNICO", "BASE TÉCNICA", "FALHA", "STATUS", "OBSERVAÇÃO", "TENSÃO"];
  const quote = (value) => `"${String(value || "").replaceAll('"', '""')}"`;
  const reportVoltage = (value) => {
    const text = String(value || "").trim().replace(/\s*v$/i, "");
    const normalized = text.replace(".", ",");
    return /^\d+(?:,\d+)?$/.test(normalized) ? `${normalized} V` : text;
  };
  const csv = [headers, ...lines.map((row) => keys.map((key) => key === "voltage" ? reportVoltage(row[key]) : row[key]))].map((line) => line.map(quote).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type:"text/csv;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href:url, download:"relatorio-atendimentos.csv" }); link.click(); URL.revokeObjectURL(url);
}

document.querySelector("#add-row-button").addEventListener("click", () => { window.reportDashboard?.clear(); createRow(); sync(); body.lastElementChild.querySelector(".site-input").focus(); });
const supervisorPicker = document.querySelector("#shift-supervisor");
try {
  const savedSupervisor = localStorage.getItem("atendimentos.shift-supervisor.v1");
  if ([...supervisorPicker.options].some((option) => option.value === savedSupervisor)) supervisorPicker.value = savedSupervisor;
} catch { /* Keep the default supervisor when browser storage is unavailable. */ }
supervisorPicker.addEventListener("change", () => {
  document.querySelector("#supervisor-name").textContent = supervisorPicker.selectedOptions[0]?.dataset.displayName || supervisorPicker.selectedOptions[0]?.textContent || "";
  try { localStorage.setItem("atendimentos.shift-supervisor.v1", supervisorPicker.value); } catch { /* The selected name still applies for this session. */ }
});
document.querySelector("#supervisor-name").textContent = supervisorPicker.selectedOptions[0]?.dataset.displayName || supervisorPicker.selectedOptions[0]?.textContent || "";
const reportClock = document.querySelector("#report-clock");
const renderReportClock = () => {
  const now = new Date();
  reportClock.dateTime = now.toISOString();
  reportClock.textContent = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short", hourCycle: "h23" }).format(now);
};
renderReportClock();
window.setInterval(renderReportClock, 30_000);
document.querySelector("#export-button").addEventListener("click", exportCsv);
document.querySelector("#search").addEventListener("input", applySearch);
document.querySelectorAll(".sort-button").forEach((button) => button.addEventListener("click", () => sortRows(button.dataset.sortKey)));
updateSortIndicators();
async function loadReport() {
  if (cloudLoaded) return;
  cloudLoaded = true;
  const generation = sessionGeneration;
  if (cloudClient) {
    failureChoices = cloudOptions.failures; statusChoices = cloudOptions.statuses;
    technicianBases = cloudOptions.technicianBases || {}; technicianChoices = cloudOptions.technicians;
    try { pendingChanges = new Map(JSON.parse(localStorage.getItem(draftKey()) || '[]')); } catch { pendingChanges = new Map(); }
    window.clearInterval(cloudPollTimer);
    cloudPollTimer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (pendingChanges.size && !syncConflict) saveCloudRows(); else refreshCloudRows();
    }, 5000);
  }
  try {
    const [options, report, health] = await Promise.all([request("/api/options"), request("/api/report"), request("/api/health")]);
    if (generation !== sessionGeneration) return;
    failureChoices = options.failures;
    statusChoices = options.statuses;
    technicianBases = options.technicianBases || {};
    technicianChoices = options.technicians;
    if (cloudClient) {
      acceptCloudRows(report.rows);
      setSyncStatus(report.rows.length ? "Relatório sincronizado com o Supabase." : "Tipologia conectada. Adicione uma linha para iniciar o relatório.", "saved");
      if (pendingChanges.size) saveCloudRows();
    } else {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(storageKey) || "null"); } catch { /* Start with the workbook when there is no usable browser cache. */ }
      addRows(saved?.length ? saved : report.rows.length ? report.rows : [{}]);
      note.textContent = health.reportSourceAvailable ? "Referências e listas suspensas prontas." : "Referências da Tipologia e técnicos prontos.";
    }
    document.body.dataset.auth = "ready";
    document.querySelector("#auth-screen").hidden = true;
    document.querySelector("#signout-button").hidden = !cloudClient;
  } catch (error) {
    if (generation !== sessionGeneration) return;
    if (cloudClient) {
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem(cacheKey()) || "null"); } catch { /* An invalid cache is ignored. */ }
      acceptCloudRows(cached || []);
      setSyncStatus(`Sem conexão com o Supabase. Exibindo cópia local, que pode estar desatualizada. ${error.message || "Reconecte para sincronizar."}`, "error");
      document.body.dataset.auth = "ready";
      document.querySelector("#auth-screen").hidden = true;
      document.querySelector("#signout-button").hidden = false;
      return;
    }
    addRows([{}]);
    note.textContent = "Não foi possível carregar as referências locais.";
  }
}

async function refreshCloudRows({ onResume = false } = {}) {
  if (!cloudClient || !cloudUser || cloudRefreshRunning || cloudSaveRunning || cloudSaveTimer || pendingChanges.size || editProblem) return;
  if (Date.now() - lastGridEditAt < 1200) return;
  if (!onResume && document.activeElement.closest?.("#attendance-table")) return;
  cloudRefreshRunning = true;
  const generation = sessionGeneration;
  try {
    const incoming = await getCloudRows();
    if (generation !== sessionGeneration || cloudSaveRunning || cloudSaveTimer || pendingChanges.size || Date.now() - lastGridEditAt < 1200) return;
    const current = [...body.rows].map(read).filter((row) => row.site);
    const signature = (rows) => JSON.stringify(rows.map((row) => [...keys.map((key) => row[key] || ""), row.id || ""]));
    if (signature(incoming.map(displayCloudRow)) === signature(current)) {
      cloudBaseline = new Map(incoming.map(row => [row.id, row]));
      window.reportDashboard?.confirmed(incoming);
      try { localStorage.setItem(cacheKey(), JSON.stringify(incoming)); } catch { /* Best effort. */ }
      setSyncStatus("Relatório sincronizado com o Supabase.", "saved");
      return;
    }
    acceptCloudRows(incoming);
    setSyncStatus("Relatório atualizado do Supabase.", "saved");
  } catch (error) {
    setSyncStatus(`Sem sincronização com o Supabase. Os dados na tela podem estar desatualizados. ${error.message || "Verifique a conexão."}`, "error");
  } finally {
    cloudRefreshRunning = false;
  }
}

function configureAuthentication() {
  const screen = document.querySelector("#auth-screen");
  const form = document.querySelector("#auth-form");
  const codeInputs = [...form.querySelectorAll(".otp-digit")];
  const message = document.querySelector("#auth-message");
  const submit = document.querySelector("#auth-submit");
  const recoveryForm = document.querySelector("#password-recovery-form");
  const recoveryMessage = document.querySelector("#recovery-message");
  const recoverySubmit = document.querySelector("#recovery-submit");
  const newCodeInput = document.querySelector("#new-access-code");
  const confirmCodeInput = document.querySelector("#confirm-access-code");
  const title = document.querySelector("#auth-title");
  const copy = document.querySelector("#auth-copy");
  let recoveryMode = authRecoveryRequested;
  let recoverySessionReady = false;
  let recoveryValidationTimer = 0;
  const showLogin = (notice = "") => {
    recoveryMode = false;
    recoverySessionReady = false;
    window.clearTimeout(recoveryValidationTimer);
    title.textContent = "Acesse o relatório";
    copy.textContent = "Digite o código de acesso para consultar e editar os atendimentos.";
    form.hidden = false;
    recoveryForm.hidden = true;
    recoverySubmit.disabled = false;
    if (notice) message.textContent = notice;
    screen.hidden = false;
    document.body.dataset.auth = "locked";
  };
  const showRecovery = (sessionReady, notice) => {
    recoveryMode = true;
    recoverySessionReady = sessionReady;
    title.textContent = "Defina seu código de acesso";
    copy.textContent = "Crie um novo código numérico de seis dígitos para acessar o relatório.";
    form.hidden = true;
    recoveryForm.hidden = false;
    recoverySubmit.disabled = !sessionReady;
    recoveryMessage.textContent = notice || (sessionReady ? "Confirme o novo código para salvar." : "Link inválido ou expirado. Solicite um novo link de recuperação.");
    screen.hidden = false;
    document.body.dataset.auth = "locked";
  };
  const clearAuthHash = () => {
    if (!window.location.hash) return;
    window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
  };
  const digitsOnly = (input) => {
    input.addEventListener("input", () => {
      const digits = input.value.replace(/\D/g, "").slice(0, 6);
      if (input.value !== digits) input.value = digits;
    });
  };
  const accessCode = () => codeInputs.map((input) => input.value).join("");
  const accessCodeComplete = () => codeInputs.every((input) => /^\d$/.test(input.value));
  const setAccessCodeDisabled = (disabled) => codeInputs.forEach((input) => { input.disabled = disabled; });
  const clearAccessCode = () => codeInputs.forEach((input) => { input.value = ""; });
  const distributeAccessCode = (startIndex, value) => {
    const digits = String(value).replace(/\D/g, "").slice(0, codeInputs.length - startIndex);
    if (!digits) return;
    message.textContent = "";
    digits.split("").forEach((digit, offset) => { codeInputs[startIndex + offset].value = digit; });
    const nextIndex = startIndex + digits.length;
    if (accessCodeComplete()) {
      codeInputs[codeInputs.length - 1].focus();
      form.requestSubmit();
    } else codeInputs[Math.min(nextIndex, codeInputs.length - 1)].focus();
  };
  codeInputs.forEach((input, index) => {
    input.addEventListener("input", () => {
      const digits = input.value.replace(/\D/g, "");
      if (digits.length > 1) {
        distributeAccessCode(index, digits);
        return;
      }
      input.value = digits.slice(-1);
      message.textContent = "";
      if (input.value && index < codeInputs.length - 1) codeInputs[index + 1].focus();
      if (accessCodeComplete()) form.requestSubmit();
    });
    input.addEventListener("paste", (event) => {
      const pasted = event.clipboardData?.getData("text") || "";
      if (!pasted) return;
      event.preventDefault();
      distributeAccessCode(index, pasted);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !input.value && index > 0) {
        codeInputs[index - 1].value = "";
        codeInputs[index - 1].focus();
      } else if (event.key === "ArrowLeft" && index > 0) codeInputs[index - 1].focus();
      else if (event.key === "ArrowRight" && index < codeInputs.length - 1) codeInputs[index + 1].focus();
    });
  });
  digitsOnly(newCodeInput);
  digitsOnly(confirmCodeInput);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    message.textContent = "Validando acesso…";
    const code = accessCode();
    if (!/^\d{6}$/.test(code)) {
      submit.disabled = false;
      message.textContent = "Digite os seis números do código de acesso.";
      codeInputs.find((input) => !input.value)?.focus();
      return;
    }
    setAccessCodeDisabled(true);
    let result;
    try {
      result = await cloudClient.auth.signInWithPassword({ email: "claudius.rangel@eqsengenharia.com.br", password: code });
    } catch (error) {
      submit.disabled = false;
      setAccessCodeDisabled(false);
      message.textContent = error.message || "Não foi possível conectar ao serviço de autenticação.";
      return;
    }
    submit.disabled = false;
    setAccessCodeDisabled(false);
    if (result.error) {
      message.textContent = /invalid login credentials/i.test(result.error.message || "")
        ? "Código inválido. Confira os seis números e tente novamente."
        : result.error.message;
      clearAccessCode();
      codeInputs[0].focus();
      return;
    }
    cloudUser = result.data.user || result.data.session?.user || null;
    screen.hidden = true;
    document.body.dataset.auth = "ready";
    await loadReport();
  });
  recoveryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!recoverySessionReady) {
      recoveryMessage.textContent = "Link inválido ou expirado. Solicite um novo link de recuperação.";
      return;
    }
    const newCode = newCodeInput.value;
    const confirmCode = confirmCodeInput.value;
    if (!/^\d{6}$/.test(newCode) || !/^\d{6}$/.test(confirmCode)) {
      recoveryMessage.textContent = "O código deve conter exatamente seis números.";
      return;
    }
    if (newCode !== confirmCode) {
      recoveryMessage.textContent = "Os códigos não coincidem. Confira os dois campos.";
      confirmCodeInput.focus();
      return;
    }
    recoverySubmit.disabled = true;
    recoveryMessage.textContent = "Salvando novo código…";
    try {
      const { error } = await cloudClient.auth.updateUser({ password: newCode });
      if (error) throw error;
      recoveryMode = false;
      recoverySessionReady = false;
      clearAuthHash();
      newCodeInput.value = "";
      confirmCodeInput.value = "";
      showLogin("Código atualizado. Entre com o novo código para acessar o relatório.");
      recoveryMessage.textContent = "";
      const { error: signOutError } = await cloudClient.auth.signOut({ scope: "global" });
      if (signOutError) message.textContent = "Código atualizado. Saia das outras sessões antes de testar o novo acesso.";
    } catch (error) {
      recoverySubmit.disabled = false;
      recoveryMessage.textContent = error.message || "Não foi possível salvar. Verifique o link e a conexão e tente novamente.";
    }
  });
  document.querySelector("#signout-button").addEventListener("click", async () => {
    await saveCloudRows();
    if (pendingChanges.size || editProblem) { setSyncStatus('Existem alterações não salvas. Resolva-as antes de sair.', 'error'); return; }
    await cloudClient.auth.signOut();
  });
  cloudClient.auth.onAuthStateChange((event, session) => {
    window.setTimeout(async () => {
      if (event === "PASSWORD_RECOVERY") {
        recoverySessionReady = true;
        window.clearTimeout(recoveryValidationTimer);
        showRecovery(true, "Link validado. Defina e confirme o novo código.");
        clearAuthHash();
        return;
      }
      if (recoveryMode && session) {
        showRecovery(false, "Aguardando a validação do link de recuperação…");
        return;
      }
      if (!session) {
        sessionGeneration++;
        window.clearTimeout(cloudSaveTimer); cloudSaveTimer = 0;
        window.clearInterval(cloudPollTimer);
        pendingChanges.clear(); cloudBaseline.clear(); observedRows.clear(); syncConflict = null;
        cloudUser = null;
        cloudLoaded = false;
        body.replaceChildren();
        if (recoveryMode) {
          window.clearTimeout(recoveryValidationTimer);
          showRecovery(false, "Link inválido ou expirado. Solicite um novo link de recuperação.");
        }
        else showLogin();
        document.querySelector("#signout-button").hidden = true;
        return;
      }
      if (cloudUser?.id !== session.user.id || !cloudLoaded) {
        cloudUser = session.user;
        document.querySelector("#auth-message").textContent = "";
        await loadReport();
      }
    }, 0);
  });
  document.body.dataset.auth = "locked";
  if (recoveryMode) {
    showRecovery(false, "Validando o link de recuperação…");
    recoveryValidationTimer = window.setTimeout(() => {
      if (recoveryMode && !recoverySessionReady) showRecovery(false, "Link inválido ou expirado. Solicite um novo link de recuperação.");
    }, 8000);
  }
  else showLogin();
  cloudClient.auth.getSession().then(({ data: { session } }) => {
    if (recoveryMode) {
      if (session && recoverySessionReady) {
        window.clearTimeout(recoveryValidationTimer);
        showRecovery(true, "Link validado. Defina e confirme o novo código.");
        clearAuthHash();
      } else if (session) showRecovery(false, "Aguardando a validação do link de recuperação…");
      else {
        window.clearTimeout(recoveryValidationTimer);
        showRecovery(false, "Link inválido ou expirado. Solicite um novo link de recuperação.");
      }
      return;
    }
    if (session) {
      cloudUser = session.user;
      screen.hidden = true;
      loadReport();
    }
  }).catch(() => {
    if (recoveryMode) {
      window.clearTimeout(recoveryValidationTimer);
      showRecovery(false, "Não foi possível validar o link. Confira a conexão ou solicite um novo link.");
    }
    else message.textContent = "Não foi possível validar a sessão. Atualize a página e tente novamente.";
  });
}

if (cloudClient) configureAuthentication();
else if (cloudRequested) {
  document.body.dataset.auth = "locked";
  document.querySelector("#auth-screen").hidden = false;
  if (authRecoveryRequested) {
    document.querySelector("#auth-title").textContent = "Recuperação indisponível";
    document.querySelector("#auth-copy").textContent = "O serviço de autenticação não carregou.";
    document.querySelector("#auth-form").hidden = true;
    document.querySelector("#password-recovery-form").hidden = false;
    document.querySelector("#recovery-submit").disabled = true;
    document.querySelector("#recovery-message").textContent = "Verifique a conexão e atualize a página antes de tentar novamente.";
  } else document.querySelector("#auth-message").textContent = "O serviço de autenticação não carregou. Verifique a conexão e atualize a página.";
} else { document.body.dataset.auth = "ready"; loadReport(); }
window.addEventListener("online", () => {
  if (!cloudClient || !cloudUser) return;
  if (pendingChanges.size) saveCloudRows(); else refreshCloudRows({ onResume: true });
});
const refreshWhenVisible = () => {
  if (document.visibilityState === "visible" && cloudClient && cloudUser) {
    if (pendingChanges.size) saveCloudRows(); else refreshCloudRows({ onResume: true });
  } else if (document.visibilityState === 'hidden' && pendingChanges.size) saveCloudRows();
};
document.addEventListener("visibilitychange", refreshWhenVisible);
window.addEventListener("focus", refreshWhenVisible);
window.addEventListener("pageshow", refreshWhenVisible);
window.addEventListener('beforeunload', event => {
  if (pendingChanges.size || cloudSaveRunning || editProblem) { event.preventDefault(); event.returnValue = ''; }
});
document.querySelector('#retry-sync').addEventListener('click', async () => {
  if (pendingChanges.size) await saveCloudRows();
  else { lastGridEditAt = 0; await refreshCloudRows({ onResume: true }); }
});
document.querySelector('#resolve-conflict').addEventListener('click', () => {
  const operation = pendingChanges.get(syncConflict?.id);
  if (!operation) return;
  const labels = { site: 'Estação', priority: 'Prioridade', quantity: 'Estações que carrega', technician: 'Técnico', base: 'Base', failure: 'Falha', status: 'Status', notes: 'Observação', voltage: 'Tensão', ordem: 'Ordem' };
  const list = document.querySelector('#conflict-values'); list.replaceChildren();
  for (const key of Object.keys(operation.patch)) {
    const item = document.createElement('li');
    item.textContent = `${labels[key] || key}: neste aparelho “${operation.patch[key] ?? ''}”; na nuvem “${syncConflict.remote?.[key] ?? ''}”.`;
    list.append(item);
  }
  document.querySelector('#keep-local').disabled = !syncConflict.remote || Boolean(operation.deleted);
  document.querySelector('#conflict-dialog').showModal();
});
async function resolveConflict(keepLocal) {
  const conflict = syncConflict;
  const operation = pendingChanges.get(conflict?.id);
  if (!operation) return;
  if (keepLocal && conflict.remote) operation.base = conflict.remote;
  else pendingChanges.delete(conflict.id);
  syncConflict = null; persistDraft();
  document.querySelector('#conflict-dialog').close();
  setSyncStatus('Sincronizando decisão…', 'pending');
  lastGridEditAt = 0;
  if (pendingChanges.size) await saveCloudRows();
  await refreshCloudRows({ onResume: true });
}
document.querySelector('#keep-local').addEventListener('click', () => resolveConflict(true));
document.querySelector('#use-cloud').addEventListener('click', () => resolveConflict(false));
document.querySelector('#close-conflict').addEventListener('click', () => document.querySelector('#conflict-dialog').close());
