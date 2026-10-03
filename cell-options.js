// One lightweight, keyboard-friendly menu surface shared by table fields,
// filters, the supervisor picker, and asynchronously loaded site suggestions.
(() => {
  const panel = document.createElement("div");
  panel.className = "cell-options";
  panel.hidden = true;
  panel.setAttribute("data-menu-surface", "true");
  const list = document.createElement("div");
  list.className = "options-list";
  list.id = "cell-options-list";
  list.setAttribute("role", "listbox");
  panel.append(list);
  document.body.append(panel);

  let active = null;
  let items = [];
  let index = -1;
  let openFrame = 0;
  const configs = new WeakMap();
  const normalize = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const toItem = value => typeof value === "string" ? { value, label: value } : value;
  const currentValue = config => config.select ? config.select.value : config.input.value;

  function updateTrigger(config) {
    if (!config.select) return;
    const selected = config.select.selectedOptions?.[0];
    if (config.labelTarget) config.labelTarget.textContent = selected?.dataset.displayName || selected?.textContent || "";
    else if (config.caption) config.caption.textContent = selected?.textContent || "";
    config.input.setAttribute("aria-label", config.ariaLabel || selected?.textContent || "Selecionar opção");
    config.input.setAttribute("aria-valuetext", selected?.textContent || "Nenhuma opção selecionada");
    config.input.dataset.selected = String(Boolean(config.select.value));
    config.input.dataset.open = String(active?.input === config.input);
  }

  function close() {
    cancelAnimationFrame(openFrame);
    const previous = active;
    active = null;
    if (previous) {
      previous.input.setAttribute("aria-expanded", "false");
      previous.input.removeAttribute("aria-activedescendant");
      if (previous.select) updateTrigger(previous);
    }
    index = -1;
    panel.hidden = true;
    panel.classList.remove("is-opening");
  }

  function highlight(next) {
    index = next;
    [...list.querySelectorAll('[role="option"]')].forEach((option, position) => {
      option.classList.toggle("is-active", position === index);
    });
    const option = list.children[index];
    if (option?.getAttribute("role") === "option") {
      active.input.setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView({ block: "nearest" });
    } else active.input.removeAttribute("aria-activedescendant");
  }

  function choose(option) {
    if (!active || !option) return;
    const config = active;
    if (config.select) {
      config.select.value = option.value;
      config.select.dispatchEvent(new Event("change", { bubbles: true }));
      updateTrigger(config);
    } else {
      config.input.value = option.value;
      config.input.dispatchEvent(new Event("change", { bubbles: true }));
      config.onSelect?.(option.value);
    }
    close();
    config.input.focus({ preventScroll: true });
  }

  function position(config) {
    const rect = config.input.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const maxWidth = Math.max(156, Math.min(320, viewportWidth - 24));
    const below = Math.max(64, window.innerHeight - rect.bottom - 16);
    const above = Math.max(64, rect.top - 16);
    const upward = below < 180 && above > below;
    const available = upward ? above : below;
    panel.style.width = "max-content";
    panel.style.minWidth = `${Math.min(rect.width, maxWidth)}px`;
    panel.style.maxWidth = `${maxWidth}px`;
    panel.style.left = `${Math.max(12, Math.min(rect.left, viewportWidth - maxWidth - 12))}px`;
    list.style.maxHeight = `${Math.max(56, Math.min(208, available - 14))}px`;
    panel.hidden = false;
    panel.dataset.placement = upward ? "above" : "below";
    panel.classList.remove("is-opening");
    const panelWidth = panel.offsetWidth;
    panel.style.width = `${panelWidth}px`;
    panel.style.left = `${Math.max(12, Math.min(rect.left, viewportWidth - panelWidth - 12))}px`;
    panel.style.top = `${upward ? Math.max(12, rect.top - panel.offsetHeight - 5) : rect.bottom + 5}px`;
    openFrame = requestAnimationFrame(() => panel.classList.add("is-opening"));
  }

  function normalizeChoices(config, query) {
    const raw = config.select
      ? [...config.select.options].filter(option => option.value !== "").map(option => ({ value: option.value, label: option.textContent }))
      : (config.choices?.() || []).map(toItem);
    const filtered = query ? raw.filter(option => normalize(option.label).includes(normalize(query))) : raw;
    if (query) return filtered;
    return config.clearable === false || !currentValue(config)
      ? filtered
      : [{ value: "", label: "Limpar campo", clear: true }, ...filtered];
  }

  function open(config, query = "") {
    close();
    active = config;
    if (config.select) updateTrigger(config);
    list.setAttribute("aria-label", config.ariaLabel || config.input.getAttribute("aria-label") || "Opções disponíveis");
    items = normalizeChoices(config, query);
    if (!items.length) {
      close();
      return;
    }
    list.replaceChildren(...items.map((item, position) => {
      const option = document.createElement("button");
      option.type = "button";
      option.tabIndex = -1;
      option.className = "cell-option";
      option.id = `cell-option-${position}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(item.value === currentValue(config)));
      option.textContent = item.label || "Limpar campo";
      if (item.clear) option.classList.add("clear-option");
      if (config.kind === "status" && item.value) option.dataset.status = normalize(item.value).replace(/[^a-z0-9]+/g, "-").replace(/-$/g, "");
      option.addEventListener("pointerdown", event => event.preventDefault());
      option.addEventListener("click", () => choose(item));
      return option;
    }));
    position(config);
    config.input.setAttribute("aria-expanded", "true");
    index = -1;
    if (!config.freeText) {
      const selectedIndex = items.findIndex(item => item.value === currentValue(config));
      if (selectedIndex >= 0) highlight(selectedIndex);
    }
  }

  function handleKeydown(config, event) {
    if (event.key === "Escape") {
      if (active?.input === config.input) {
        event.preventDefault();
        close();
        config.input.focus({ preventScroll: true });
      }
      return;
    }
    if (event.key === "Tab") { if (active?.input === config.input) close(); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (active?.input !== config.input) open(config);
      if (items.length) highlight(index < 0 ? (event.key === "ArrowDown" ? 0 : items.length - 1) : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
    } else if (event.key === "Home" || event.key === "End") {
      if (active?.input === config.input && items.length) {
        event.preventDefault();
        highlight(event.key === "Home" ? 0 : items.length - 1);
      }
    } else if (event.key === "Enter" || (event.key === " " && !config.freeText)) {
      if (config.select && active?.input !== config.input) { event.preventDefault(); open(config); return; }
      event.preventDefault();
      if (active?.input === config.input && index >= 0 && items[index]) choose(items[index]);
      else if (active?.input === config.input && config.enterSelectFirst && items[0]) choose(items[0]);
      else if (!config.select && config.freeText) {
        config.input.dispatchEvent(new Event("change", { bubbles: true }));
        close();
      } else if (active?.input !== config.input) open(config);
    } else if (!config.select && !config.freeText && ["Backspace", "Delete"].includes(event.key)) {
      event.preventDefault();
      config.input.value = "";
      config.input.dispatchEvent(new Event("change", { bubbles: true }));
      close();
    }
  }

  function attach(input, choices, { freeText = false, kind = "", openOnClick = true, clearable = true, enterSelectFirst = false, onSelect, onInput } = {}) {
    const config = { input, choices, freeText, kind, openOnClick, clearable, enterSelectFirst, onSelect, onInput, emptyMessage: "" };
    configs.set(input, config);
    input.removeAttribute("list");
    input.readOnly = !freeText;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-haspopup", "listbox");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", list.id);
    input.setAttribute("aria-autocomplete", freeText ? "list" : "none");
    input.addEventListener("click", () => {
      if (!openOnClick && !input.value.trim()) return;
      active?.input === input ? close() : open(config, freeText ? input.value : "");
    });
    if (freeText) input.addEventListener("input", () => {
      if (!input.value.trim() && !openOnClick) {
        if (active?.input === input) close();
        config.onInput?.(input.value);
        return;
      }
      open(config, input.value);
      config.onInput?.(input.value);
    });
    input.addEventListener("blur", () => { if (active?.input === input) close(); });
    input.addEventListener("keydown", event => handleKeydown(config, event));
  }

  function bindSelect(select, { trigger = null, labelTarget = null, ariaLabel = "", clearable = false } = {}) {
    const config = { select, clearable, ariaLabel, labelTarget };
    if (!trigger) {
      trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "menu-select-trigger";
      trigger.id = `${select.id}-trigger`;
      trigger.setAttribute("aria-label", ariaLabel || select.getAttribute("aria-label") || "Selecionar opção");
      config.caption = document.createElement("span");
      config.caption.className = "menu-select-label";
      const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      chevron.setAttribute("viewBox", "0 0 24 24");
      chevron.setAttribute("aria-hidden", "true");
      chevron.classList.add("menu-select-chevron");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "m7 10 5 5 5-5");
      chevron.append(path);
      trigger.append(config.caption, chevron);
      select.after(trigger);
    }
    config.input = trigger;
    configs.set(select, config);
    select.classList.add("dropdown-native-source");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", list.id);
    if (ariaLabel) trigger.setAttribute("aria-label", ariaLabel);
    trigger.addEventListener("click", () => active?.input === trigger ? close() : open(config));
    trigger.addEventListener("keydown", event => handleKeydown(config, event));
    select.addEventListener("change", () => updateTrigger(config));
    new MutationObserver(() => {
      updateTrigger(config);
      if (active?.input === trigger) open(config);
    }).observe(select, { childList: true, subtree: true, characterData: true });
    updateTrigger(config);
    return { trigger, sync: () => updateTrigger(config) };
  }

  function refresh(input) {
    const config = configs.get(input);
    if (active?.input === input) open(active, input.value);
    else if (config?.freeText && config.openOnClick === false && document.activeElement === input && input.value.trim()) open(config, input.value);
  }

  function setEmptyMessage(input, message) {
    const config = configs.get(input);
    if (!config) return;
    if (config.emptyMessage === message) return;
    config.emptyMessage = message;
    refresh(input);
  }

  document.addEventListener("pointerdown", event => {
    if (active && event.target !== active.input && !panel.contains(event.target)) close();
  });
  window.addEventListener("resize", close);
  document.addEventListener("scroll", event => { if (active && !panel.contains(event.target)) close(); }, true);
  window.cellOptions = { attach, bindSelect, refresh, setEmptyMessage, sync: select => configs.get(select) && updateTrigger(configs.get(select)), close };

  document.querySelectorAll("select[data-menu-select]").forEach(select => bindSelect(select, {
    trigger: select.dataset.menuTrigger ? document.getElementById(select.dataset.menuTrigger) : null,
    labelTarget: select.dataset.menuLabel ? document.querySelector(select.dataset.menuLabel) : null,
    ariaLabel: select.getAttribute("aria-label") || "Selecionar filtro"
  }));
})();
