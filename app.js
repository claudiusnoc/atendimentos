const keys = ["site", "priority", "quantity", "technician", "base", "failure", "status", "notes", "voltage"];
const storageKey = "atendimentos.grid.v4";
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
const sitePopover = document.querySelector("#site-popover");
let activeSiteInput = null;
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
let cloudLoaded = false;
let authMode = "signin";

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
    .select("id,ordem,site,priority,quantity,technician,base,failure,status,notes,voltage")
    .order("ordem").order("created_at");
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id, site: row.site, priority: row.priority || "", quantity: row.quantity || "",
    technician: row.technician || "", base: row.base || "", failure: row.failure || "",
    status: row.status || "", notes: row.notes || "",
    voltage: row.voltage == null ? "" : String(row.voltage).replace(".", ","),
  }));
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
  try { localStorage.setItem(reportCacheKey, JSON.stringify(records)); } catch { /* Cloud saves remain available if browser storage is disabled. */ }
  if (cloudClient && cloudUser) {
    window.clearTimeout(cloudSaveTimer);
    cloudSaveTimer = window.setTimeout(saveCloudRows, 450);
  }
};
const read = (row) => ({ ...Object.fromEntries(Object.entries(fields(row)).map(([key, element]) => [key, element.value.trim()])), id: row.dataset.recordId || "" });
const updateCount = () => {};
const sync = () => { records = [...body.rows].map(read); save(); updateCount(); };
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
  [...body.rows].forEach((row) => { row.hidden = !Object.values(read(row)).join(" ").toLocaleLowerCase("pt-BR").includes(query); });
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
  hideSitePopover();
  cellOptions.close();
  body.replaceChildren(...sorted);
  sync();
  applySearch();
  updateSortIndicators();
}

async function saveCloudRows() {
  if (!cloudClient || !cloudUser) return;
  if (cloudSaveRunning) { cloudSaveAgain = true; return; }
  cloudSaveRunning = true;
  try {
    for (const [index, row] of [...body.rows].entries()) {
      const record = read(row);
      if (!record.site || row.dataset.validSite !== "true") continue;
      const voltage = record.voltage.trim().replace(/\s*v$/i, "").replace(",", ".");
      const payload = {
        ...(record.id ? { id: record.id } : {}),
        site: normalizeSite(record.site), priority: record.priority, quantity: record.quantity, ordem: index + 1,
        technician: record.technician, base: record.base, failure: record.failure,
        status: record.status, notes: record.notes,
        voltage: /^\d+(?:\.\d+)?$/.test(voltage) ? Number(voltage) : null,
      };
      const { data, error } = await cloudClient.from("atendimentos").upsert(payload, { onConflict: "id" }).select("id").single();
      if (error) throw error;
      row.dataset.recordId = data.id;
    }
    note.textContent = "Alterações salvas no Supabase.";
  } catch (error) {
    note.textContent = `Não foi possível salvar no Supabase: ${error.message || "verifique a conexão e a Tipologia importada."}`;
  } finally {
    cloudSaveRunning = false;
    if (cloudSaveAgain) { cloudSaveAgain = false; saveCloudRows(); }
  }
}

async function deleteCloudRow(id) {
  if (!id || !cloudClient || !cloudUser) return;
  const { error } = await cloudClient.from("atendimentos").delete().eq("id", id);
  if (error) note.textContent = `Não foi possível remover a linha: ${error.message}`;
}

function hideSitePopover() { sitePopover.classList.add("hidden"); activeSiteInput = null; }
function chooseSite(input, site) { input.value = site; input.dispatchEvent(new Event("change")); hideSitePopover(); }
function showSitePopover(input, items) {
  if (!input.value.trim() || !items.length) return hideSitePopover();
  activeSiteInput = input;
  sitePopover.replaceChildren(...items.map((site) => {
    const option = Object.assign(document.createElement("button"), { className: "site-option", type: "button", textContent: site, role: "option" });
    option.addEventListener("mousedown", (event) => { event.preventDefault(); chooseSite(input, site); });
    return option;
  }));
  const box = input.getBoundingClientRect();
  sitePopover.style.left = `${Math.min(box.left, window.innerWidth - 282)}px`;
  sitePopover.style.top = `${box.bottom + 4}px`;
  sitePopover.style.maxHeight = `${Math.max(96, Math.min(250, window.innerHeight - box.bottom - 12))}px`;
  sitePopover.classList.remove("hidden");
}
async function suggestSites(input) {
  if (!input.value.trim()) return hideSitePopover();
  try { const sites = await request(`/api/sites?q=${encodeURIComponent(input.value)}`); if ((activeSiteInput === input || document.activeElement === input) && input.value.trim()) showSitePopover(input, sites.items); } catch { note.textContent = "Não foi possível consultar a Tipologia."; }
}
function createRow(record = {}) {
  const fragment = template.content.cloneNode(true);
  const row = fragment.querySelector("tr");
  if (record.id) row.dataset.recordId = record.id;
  if (record.site) row.dataset.validSite = "true";
  // Replace native selects with the same styled combobox used by technicians.
  row.querySelectorAll("select").forEach((select) => {
    const input = document.createElement("input");
    input.className = select.className;
    input.setAttribute("aria-label", select.getAttribute("aria-label"));
    input.autocomplete = "off";
    select.replaceWith(input);
  });
  const rowFields = fields(row);
  Object.entries(rowFields).forEach(([key, input]) => {
    const paint = () => { if (key === "priority") paintPriority(input); if (key === "status") paintStatus(input); if (key === "failure") paintFailure(input); if (key === "voltage") paintVoltage(input); };
    const value = key === "technician" && record[key] === "APOIO OS" ? "APOIO OESTE" : String(record[key] || "");
    input.value = key === "voltage" ? value.trim().replace(/\s*v$/i, "").replace(".", ",") : value;
    paint();
    ["input", "change"].forEach((event) => input.addEventListener(event, () => { paint(); sync(); }));
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
  rowFields.technician.addEventListener("change", () => { const base = technicianBases[technicianToken(rowFields.technician.value)]; if (base) rowFields.base.value = base; sync(); });
  rowFields.site.addEventListener("focus", hideSitePopover);
  rowFields.site.addEventListener("input", async () => {
    rowFields.site.value = normalizeSite(rowFields.site.value);
    row.dataset.validSite = "";
    if (!rowFields.site.value.trim()) return hideSitePopover();
    activeSiteInput = rowFields.site;
    suggestSites(rowFields.site);
  });
  rowFields.site.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const firstSuggestion = sitePopover.querySelector(".site-option");
    if (firstSuggestion && !sitePopover.classList.contains("hidden")) return chooseSite(rowFields.site, firstSuggestion.textContent);
    rowFields.site.dispatchEvent(new Event("change"));
  });
  rowFields.site.addEventListener("change", async () => {
    const code = normalizeSite(rowFields.site.value);
    rowFields.site.value = code;
    hideSitePopover();
    if (!code) { hideSitePopover(); return sync(); }
    try {
      const site = await request(`/api/sites/${encodeURIComponent(code)}`);
      row.dataset.validSite = "true";
      rowFields.priority.value = site.priority || "";
      paintPriority(rowFields.priority);
      rowFields.quantity.value = site.quantity || "";
      note.textContent = `${code}: referências da Tipologia aplicadas à linha.`;
    } catch {
      row.dataset.validSite = "";
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
  const headers = ["ESTAÇÃO", "PRIORIDADE", "QTD ESTAÇÕES", "TÉCNICO", "BASE TÉCNICA", "FALHA", "STATUS", "OBSERVAÇÃO", "TENSÃO"];
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

document.querySelector("#add-row-button").addEventListener("click", () => { createRow(); sync(); body.lastElementChild.querySelector(".site-input").focus(); });
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
document.addEventListener("mousedown", (event) => { if (!sitePopover.contains(event.target) && event.target !== activeSiteInput) hideSitePopover(); });

async function loadReport() {
  if (cloudLoaded) return;
  cloudLoaded = true;
  try {
    const [options, report, health] = await Promise.all([request("/api/options"), request("/api/report"), request("/api/health")]);
    failureChoices = options.failures;
    statusChoices = options.statuses;
    technicianBases = options.technicianBases || {};
    technicianChoices = options.technicians;
    if (cloudClient) {
      addRows(report.rows.length ? report.rows : [{}]);
      note.textContent = report.rows.length ? "Relatório sincronizado com o Supabase." : "Tipologia conectada. Adicione uma linha para iniciar o relatório.";
      window.setInterval(refreshCloudRows, 15_000);
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
    cloudLoaded = false;
    if (cloudClient) {
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem(reportCacheKey) || "null"); } catch { /* An invalid cache is ignored. */ }
      note.textContent = `Sem conexão com o Supabase. Exibindo o cache local: ${error.message || "reconecte para sincronizar."}`;
      addRows(cached?.length ? cached : [{}]);
      window.setInterval(refreshCloudRows, 15_000);
      document.body.dataset.auth = "ready";
      document.querySelector("#auth-screen").hidden = true;
      document.querySelector("#signout-button").hidden = false;
      return;
    }
    addRows([{}]);
    note.textContent = "Não foi possível carregar as referências locais.";
  }
}

async function refreshCloudRows() {
  if (!cloudClient || !cloudUser || document.activeElement.closest?.("#attendance-table") || cloudSaveRunning || cloudSaveTimer) return;
  try {
    const incoming = await getCloudRows();
    const current = [...body.rows].map(read).filter((row) => row.site);
    const signature = (rows) => JSON.stringify(rows.map((row) => [...keys.map((key) => row[key] || ""), row.id || ""]));
    if (signature(incoming) === signature(current)) return;
    body.replaceChildren();
    addRows(incoming.length ? incoming : [{}]);
    records = [...body.rows].map(read);
    try { localStorage.setItem(reportCacheKey, JSON.stringify(records)); } catch { /* Remote state remains authoritative. */ }
  } catch { /* Keep the current report visible during a temporary connection interruption. */ }
}

function configureAuthentication() {
  const screen = document.querySelector("#auth-screen");
  const form = document.querySelector("#auth-form");
  const message = document.querySelector("#auth-message");
  const submit = document.querySelector("#auth-submit");
  const switchButton = document.querySelector("#auth-switch");
  const setMode = (mode) => {
    authMode = mode;
    document.querySelector("#auth-title").textContent = mode === "signin" ? "Acesse o relatório" : "Crie sua conta";
    document.querySelector(".auth-copy").textContent = mode === "signin" ? "Entre com seu e-mail e senha para consultar e editar os atendimentos." : "Use seu e-mail de trabalho para criar o acesso ao relatório.";
    submit.textContent = mode === "signin" ? "Entrar" : "Criar conta";
    switchButton.textContent = mode === "signin" ? "Criar uma conta" : "Já tenho uma conta";
    message.textContent = "";
  };
  switchButton.addEventListener("click", () => setMode(authMode === "signin" ? "signup" : "signin"));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    message.textContent = authMode === "signin" ? "Validando acesso…" : "Criando acesso…";
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    let result;
    try {
      result = authMode === "signin"
        ? await cloudClient.auth.signInWithPassword({ email, password })
        : await cloudClient.auth.signUp({ email, password });
    } catch (error) {
      submit.disabled = false;
      message.textContent = error.message || "Não foi possível conectar ao serviço de autenticação.";
      return;
    }
    submit.disabled = false;
    if (result.error) {
      message.textContent = result.error.message;
      return;
    }
    if (authMode === "signup" && !result.data.session) {
      message.textContent = "Conta criada. Confirme o e-mail enviado e depois entre no relatório.";
      return;
    }
    cloudUser = result.data.user || result.data.session?.user || null;
    screen.hidden = true;
    document.body.dataset.auth = "ready";
    await loadReport();
  });
  document.querySelector("#signout-button").addEventListener("click", async () => {
    await cloudClient.auth.signOut();
  });
  cloudClient.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(async () => {
      if (!session) {
        cloudUser = null;
        cloudLoaded = false;
        body.replaceChildren();
        screen.hidden = false;
        document.body.dataset.auth = "locked";
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
  screen.hidden = false;
  cloudClient.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      cloudUser = session.user;
      screen.hidden = true;
      loadReport();
    }
  }).catch(() => { message.textContent = "Não foi possível validar a sessão. Atualize a página e tente novamente."; });
}

if (cloudClient) configureAuthentication();
else if (cloudRequested) {
  document.body.dataset.auth = "locked";
  document.querySelector("#auth-screen").hidden = false;
  document.querySelector("#auth-message").textContent = "O serviço de autenticação não carregou. Verifique a conexão e atualize a página.";
} else { document.body.dataset.auth = "ready"; loadReport(); }
window.addEventListener("online", () => { if (cloudClient && cloudUser) saveCloudRows(); });
