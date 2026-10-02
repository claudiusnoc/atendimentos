// Column presentation stays independent of report values and sorting.
(() => {
  const table = document.querySelector("#attendance-table");
  const wrapper = table.closest(".table-wrap");
  const storageKey = "atendimentos.column-widths.v2";
  const columns = [
    { key: "site", label: "estação", width: 124, min: 104, icon: '<circle cx="12" cy="6" r="1.5"/><path d="m12 8-5 13m5-13 5 13M9 16h6M5 3a7 7 0 0 0 0 8M19 3a7 7 0 0 1 0 8"/>' },
    { key: "priority", label: "prioridade", width: 128, min: 112, icon: '<path d="m6 11 6-6 6 6M6 18l6-6 6 6"/>' },
    { key: "quantity", label: "quantidade de instalações", width: 164, min: 128, icon: '<rect x="9" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M12 9v3M6 15v-3h12v3"/>' },
    { key: "technician", label: "técnico", width: 144, min: 112, icon: '<path d="M5 10a7 7 0 0 1 14 0M12 3v4M3 10h18M8 12a4 4 0 0 0 8 0M5 21v-2c0-2 3-3 7-3s7 1 7 3v2"/>' },
    { key: "base", label: "base técnica", width: 108, min: 100, icon: '<path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7"/>' },
    { key: "failure", label: "falha", width: 218, min: 140, icon: '<path d="m10.3 4-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0ZM12 9v5m0 3v.1"/>' },
    { key: "status", label: "status", width: 164, min: 144, icon: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>' },
    { key: "notes", label: "observação", width: 180, min: 144, icon: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>' },
    { key: "voltage", label: "tensão", width: 92, min: 84, icon: '<path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/>' },
  ];
  const compactWidths = [96, 100, 148, 132, 84, 110, 128, 240, 80];
  const compactMinimums = [84, 90, 112, 104, 74, 100, 116, 180, 72];
  columns.forEach((column, index) => { column.width = compactWidths[index]; column.min = compactMinimums[index]; });
  let saved = {};
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) saved = value;
  } catch { /* Invalid or unavailable preferences use the default layout. */ }
  const clamp = (value, column) => Math.round(Math.max(column.min, Math.min(720, value)));
  const widths = columns.map((column) => Number.isFinite(saved[column.key]) ? clamp(saved[column.key], column) : column.width);
  const group = document.createElement("colgroup");
  const colElements = [...columns, { key: "actions" }].map(({ key }) => {
    const col = document.createElement("col");
    col.dataset.column = key;
    group.append(col);
    return col;
  });
  table.insertBefore(group, table.tHead);
  const handles = [];
  let drag = null;

  function renderWidths() {
    // Spare desktop space belongs to observations, never to short code fields.
    const rendered = [...widths];
    if (!Number.isFinite(saved.notes)) rendered[7] += Math.max(0, wrapper.clientWidth - 28 - widths.reduce((sum, width) => sum + width, 0));
    rendered.forEach((width, index) => {
      colElements[index].style.width = `${width}px`;
      handles[index]?.setAttribute("aria-valuenow", String(width));
      handles[index]?.setAttribute("aria-valuetext", `${width} pixels`);
    });
    colElements[9].style.width = "28px";
    table.style.width = `${rendered.reduce((sum, width) => sum + width, 28)}px`;
  }
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch { /* Resizing still works when storage is unavailable. */ }
  }
  function resize(index, width) {
    widths[index] = clamp(width, columns[index]);
    saved[columns[index].key] = widths[index];
    renderWidths();
  }
  columns.forEach((column, index) => {
    const header = table.tHead.rows[0].cells[index];
    const target = header.querySelector(".sort-button") || header;
    const label = document.createElement("span");
    label.className = "column-label";
    // Existing heading text is retained verbatim; only the icon is added.
    const text = [...target.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    const caption = document.createElement("span");
    caption.textContent = text?.textContent || "";
    text?.remove();
    label.innerHTML = `<svg class="column-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${column.icon}</svg>`;
    label.prepend(caption);
    target.prepend(label);
    const handle = document.createElement("span");
    handle.className = "column-resizer";
    handle.tabIndex = 0;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", `Largura da coluna ${column.label}`);
    handle.setAttribute("aria-valuemin", String(column.min));
    handle.setAttribute("aria-valuemax", "720");
    handle.setAttribute("aria-controls", "attendance-table");
    handle.title = "Arraste para ajustar • Duplo clique para restaurar";
    handle.addEventListener("click", (event) => event.stopPropagation());
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      hideSuggestions();
      drag = { index, x: event.clientX, width: header.getBoundingClientRect().width, original: widths[index], preference: saved[column.key] };
      handle.setPointerCapture(event.pointerId);
      handle.classList.add("is-resizing");
      document.body.classList.add("resizing-columns");
    });
    handle.addEventListener("pointermove", (event) => {
      if (drag?.index === index) resize(index, drag.width + event.clientX - drag.x);
    });
    const finish = (event) => {
      if (drag?.index !== index) return;
      if (event.type === "pointercancel") {
        widths[index] = drag.original;
        if (drag.preference === undefined) delete saved[column.key];
        else saved[column.key] = drag.preference;
        renderWidths();
      }
      drag = null;
      handle.classList.remove("is-resizing");
      document.body.classList.remove("resizing-columns");
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      persist();
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("lostpointercapture", finish);
    const reset = () => { delete saved[column.key]; widths[index] = column.width; renderWidths(); persist(); };
    handle.addEventListener("dblclick", reset);
    handle.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Home") return reset();
      resize(index, header.getBoundingClientRect().width + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 24 : 8));
      persist();
    });
    handles.push(handle);
    header.append(handle);
  });
  function hideSuggestions() { document.querySelector("#site-popover").classList.add("hidden"); }
  renderWidths();
  new ResizeObserver(() => { if (!drag) renderWidths(); }).observe(wrapper);
})();
