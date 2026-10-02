// Shared, keyboard-accessible options panel for the report cells.
const cellOptions = (() => {
  const panel = document.createElement("div");
  panel.className = "cell-options";
  panel.hidden = true;
  const heading = document.createElement("div");
  heading.className = "options-heading";
  const list = document.createElement("div");
  list.className = "options-list";
  list.id = "cell-options-list";
  list.setAttribute("role", "listbox");
  panel.append(heading, list);
  document.body.append(panel);
  let active = null;
  let items = [];
  let index = -1;
  const token = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  function close() {
    if (active) {
      active.input.setAttribute("aria-expanded", "false");
      active.input.removeAttribute("aria-activedescendant");
    }
    active = null;
    panel.hidden = true;
  }
  function highlight(next) {
    index = next;
    [...list.children].forEach((option, position) => option.classList.toggle("is-active", position === index));
    const option = list.children[index];
    if (option) {
      active.input.setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView({ block: "nearest" });
    } else active.input.removeAttribute("aria-activedescendant");
  }
  function choose(value) {
    const input = active.input;
    input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    close();
    input.focus({ preventScroll: true });
  }
  function open(config, query = "") {
    close();
    active = config;
    document.querySelector("#site-popover").classList.add("hidden");
    heading.textContent = config.input.getAttribute("aria-label");
    list.setAttribute("aria-label", heading.textContent);
    const choices = config.choices().filter((value) => token(value).includes(token(query)));
    items = query ? choices : ["", ...choices];
    list.replaceChildren(...items.map((value, position) => {
      const option = document.createElement("button");
      option.type = "button";
      option.tabIndex = -1;
      option.className = "cell-option";
      option.id = `cell-option-${position}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(value === config.input.value));
      option.textContent = value || "Limpar campo";
      if (!value) option.classList.add("clear-option");
      if (config.kind === "status" && value) option.dataset.status = token(value).replace(/[^a-z0-9]+/g, "-").replace(/-$/g, "");
      option.addEventListener("pointerdown", (event) => event.preventDefault());
      option.addEventListener("click", () => choose(value));
      return option;
    }));
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "options-empty";
      empty.textContent = config.freeText ? "Nome livre: pressione Enter para confirmar." : "Nenhuma opção encontrada.";
      list.append(empty);
    }
    const rect = config.input.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const width = Math.min(Math.max(rect.width, 272), viewportWidth - 24);
    panel.style.width = `${width}px`;
    panel.style.left = `${Math.max(12, Math.min(rect.left, viewportWidth - width - 12))}px`;
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const upward = below < 200 && above > below;
    list.style.maxHeight = `${Math.max(56, Math.min(272, (upward ? above : below) - 46))}px`;
    panel.hidden = false;
    panel.style.top = `${upward ? Math.max(12, rect.top - panel.offsetHeight - 5) : rect.bottom + 5}px`;
    config.input.setAttribute("aria-expanded", "true");
    index = -1;
    // Keep the typed technician name unless the user explicitly navigates a suggestion.
    if (!config.freeText) highlight(Math.max(0, items.indexOf(config.input.value)));
  }
  function attach(input, choices, { freeText = false, kind = "" } = {}) {
    const config = { input, choices, freeText, kind };
    input.removeAttribute("list");
    input.readOnly = !freeText;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-haspopup", "listbox");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", list.id);
    input.setAttribute("aria-autocomplete", freeText ? "list" : "none");
    input.addEventListener("click", () => active?.input === input ? close() : open(config));
    if (freeText) input.addEventListener("input", () => open(config, input.value));
    input.addEventListener("blur", close);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key === "Tab") { close(); return; }
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        if (active?.input !== input) open(config);
        if (items.length) highlight((index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (active?.input === input) {
          if (index >= 0 && items[index] !== undefined) choose(items[index]);
          else { input.dispatchEvent(new Event("change", { bubbles: true })); close(); }
        } else if (!freeText) open(config);
        else input.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (!freeText && ["Backspace", "Delete"].includes(event.key)) {
        event.preventDefault();
        input.value = "";
        input.dispatchEvent(new Event("change", { bubbles: true }));
        close();
      }
    });
  }
  document.addEventListener("pointerdown", (event) => {
    if (active && event.target !== active.input && !panel.contains(event.target)) close();
  });
  window.addEventListener("resize", close);
  document.addEventListener("scroll", (event) => { if (!panel.contains(event.target)) close(); }, true);
  return { attach, close };
})();
