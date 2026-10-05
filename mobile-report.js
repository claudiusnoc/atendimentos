/* Mobile chrome only: original table fields, sorting and cloud-save handlers stay intact. */
(() => {
  const records = document.getElementById('records');
  const wrapper = document.querySelector('.table-wrap');
  const mobile = matchMedia('(max-width: 767px)');
  if (!records || !wrapper) return;
  const tools = document.querySelector('.topbar-tools');
  const actions = document.querySelector('.report-heading-actions');
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.className = 'mobile-only mobile-tools-toggle';
  toggle.setAttribute('aria-label','Ações do relatório'); toggle.setAttribute('aria-expanded','false');
  actions.id = 'mobile-report-actions'; toggle.setAttribute('aria-controls',actions.id);
  toggle.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2" fill="white"/><circle cx="16" cy="12" r="2" fill="white"/><circle cx="9" cy="18" r="2" fill="white"/></svg>';
  toggle.addEventListener('click',() => {
    const open = tools.classList.toggle('mobile-tools-open');
    toggle.setAttribute('aria-expanded',String(open));
    if (!open) document.querySelector('.export-menu').open = false;
  });
  tools.append(toggle);
  const exit = document.createElement('button');
  exit.type = 'button'; exit.className = 'mobile-only report-button mobile-signout'; exit.textContent = 'Sair';
  exit.addEventListener('click',() => document.getElementById('signout-button').click()); actions.append(exit);
  const initials = document.createElement('span');
  initials.className = 'mobile-only mobile-supervisor-initials'; initials.setAttribute('aria-hidden','true');
  document.querySelector('.supervisor-avatar').append(initials);
  const heading = document.createElement('div'); heading.className = 'mobile-only mobile-list-heading';
  const count = document.createElement('strong'); count.setAttribute('role','status');
  const hint = document.createElement('span'); hint.className = 'mobile-scroll-hint';
  hint.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18M7 8l-4 4 4 4m10-8 4 4-4 4"/></svg><span>Deslize para ver as colunas</span>';
  heading.append(count,hint); wrapper.before(heading);
  let frame = 0;
  function render() {
    frame = 0;
    if (!mobile.matches) { wrapper.removeAttribute('tabindex'); wrapper.removeAttribute('aria-label'); return; }
    wrapper.tabIndex = 0; wrapper.setAttribute('aria-label','Tabela de atendimentos com rolagem horizontal');
    const visible = [...records.rows].filter(row => !row.hidden && row.querySelector('.site-input').value.trim()).length;
    const label = `${visible} ${visible === 1 ? 'acionamento' : 'acionamentos'}`;
    if (count.textContent !== label) count.textContent = label;
    document.querySelectorAll('.report-filter .menu-select-trigger').forEach(trigger => {
      const select = trigger.previousElementSibling;
      trigger.dataset.mobileCaption = select.value || ({'filter-base':'Bases','filter-priority':'Níveis','filter-status':'Status'}[select.id] || 'Filtrar');
    });
    initials.textContent = document.getElementById('supervisor-name').textContent.trim().split(/\s+/).slice(0,2).map(word=>word[0]).join('');
    exit.hidden = document.getElementById('signout-button').hidden;
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(render); }
  records.addEventListener('input',schedule);
  document.querySelector('.report-filters').addEventListener('change',schedule);
  document.getElementById('shift-supervisor').addEventListener('change',schedule);
  new MutationObserver(schedule).observe(records,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
  new MutationObserver(schedule).observe(document.getElementById('signout-button'),{attributes:true,attributeFilter:['hidden']});
  mobile.addEventListener('change',() => { window.cellOptions?.close(); schedule(); });
  schedule();
})();
