/* Report presentation: derived summaries and local filters, never database writes. */
(() => {
  const $ = id => document.getElementById(id);
  const token = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
  const rank = value => Number(token(value).match(/\d+/)?.[0] ?? 99);
  const critical = row => (rank(row.priority) >= 0 && rank(row.priority) <= 4) || token(row.failure) === 'INOPERANTE';
  let criticalOnly = false;
  let currentRows = [];
  const filterFields = { 'filter-base': 'base', 'filter-priority': 'priority', 'filter-status': 'status' };
  const refresh = () => { window.applySearch?.(); updateCardStates(); };
  function updateCardStates() {
    $('critical-card').setAttribute('aria-pressed', String(criticalOnly));
    $('transit-card').setAttribute('aria-pressed', String($('filter-status').value === 'EM DESLOCAMENTO'));
    $('gmg-card').setAttribute('aria-pressed', String($('filter-status').value === 'GMG ACOPLADO'));
  }
  function options(id, rows, key) {
    const select = $(id), selected = select.value;
    const values = [...new Set(rows.map(row => row[key]).filter(Boolean))].sort((a,b) => key === 'priority' ? rank(a)-rank(b) : a.localeCompare(b,'pt-BR'));
    if (selected && !values.includes(selected)) values.push(selected);
    if (JSON.stringify([...select.options].slice(1).map(o=>o.value)) === JSON.stringify(values)) return;
    const placeholder = select.options[0].textContent;
    select.replaceChildren(new Option(placeholder, ''), ...values.map(value=>new Option(value,value)));
    select.value = selected;
  }
  function fitRows() {
    document.querySelectorAll('#records textarea').forEach(input => {
      input.style.height = '26px';
      if (input.offsetWidth) input.style.height = `${Math.max(26, input.scrollHeight + 2)}px`;
    });
  }
  function update(rows) {
    currentRows = rows.filter(row=>row.site);
    const total = currentRows.length;
    const criticalCount = new Set(currentRows.filter(critical).map(row=>token(row.site))).size;
    const transit = currentRows.filter(row=>token(row.status)==='EM DESLOCAMENTO').length;
    const gmg = currentRows.filter(row=>token(row.status)==='GMG ACOPLADO').length;
    $('critical-count').textContent = criticalCount;
    for (const [name,count] of [['transit',transit],['gmg',gmg]]) {
      const percent = total ? Math.round(count/total*100) : 0;
      $(name+'-count').textContent = count;
      $(name+'-percent').textContent = `${percent}% do total`;
      $(name+'-progress').value = percent;
    }
    $('notification-critical').textContent = `${criticalCount} ${criticalCount===1?'site crítico':'sites críticos'}: prioridade de nível 0 a 4 ou falha INOPERANTE.`;
    document.querySelector('.notification-dot').hidden = criticalCount===0;
    for (const [id,key] of Object.entries(filterFields)) options(id,currentRows,key);
    updateCardStates(); fitRows();
  }
  function matches(row) {
    return (!criticalOnly || critical(row)) && Object.entries(filterFields).every(([id,key])=>!$(id).value || token(row[key])===token($(id).value));
  }
  function visible(count) {
    const empty = $('empty-results');
    empty.hidden = count > 0;
    $('visible-records').textContent = `${count} de ${currentRows.length} atendimentos`;
    requestAnimationFrame(fitRows);
  }
  function confirmed(rows) {
    const timestamps = rows.map(row=>Date.parse(row.updated_at)).filter(Number.isFinite);
    const date = timestamps.length ? new Date(Math.max(...timestamps)) : null;
    const time = $('last-cloud-update');
    if (date) {
      time.dateTime = date.toISOString();
      time.textContent = new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(date);
    } else { time.removeAttribute('datetime'); time.textContent = rows.length ? 'Não disponível' : 'Sem atendimentos'; }
  }
  function sync(message,state) {
    $('notification-sync').textContent = message;
    document.querySelector('.updated-card').dataset.sync=state;
    document.querySelector('.toolbar').dataset.sync=state;
    $('retry-sync').setAttribute('aria-busy',String(state==='pending'));
  }
  $('critical-card').addEventListener('click',()=>{criticalOnly=!criticalOnly;refresh();});
  for (const [id,status] of [['transit-card','EM DESLOCAMENTO'],['gmg-card','GMG ACOPLADO']]) {
    $(id).addEventListener('click',()=>{
      const field=$('filter-status');
      if (![...field.options].some(option=>option.value===status)) field.add(new Option(status,status));
      field.value=field.value===status?'':status;refresh();
    });
  }
  Object.keys(filterFields).forEach(id=>$(id).addEventListener('change',refresh));
  function clear() { criticalOnly=false; Object.keys(filterFields).forEach(id=>$(id).value=''); $('search').value='';refresh(); }
  $('clear-filters').addEventListener('click',clear);
  const empty=document.createElement('div');empty.id='empty-results';empty.className='empty-results';empty.hidden=true;
  const copy=document.createElement('p');copy.textContent='Nenhum atendimento corresponde à busca e aos filtros.';
  const reset=document.createElement('button');reset.type='button';reset.className='report-button';reset.textContent='Limpar busca e filtros';reset.addEventListener('click',clear);
  empty.append(copy,reset);document.querySelector('.table-wrap').after(empty);
  const count=document.createElement('span');count.id='visible-records';count.setAttribute('role','status');document.querySelector('.report-actions').append(count);
  $('print-report').addEventListener('click',()=>{document.querySelector('.export-menu').open=false;window.print();});
  $('export-button').addEventListener('click',()=>{document.querySelector('.export-menu').open=false;});
  document.addEventListener('keydown',event=>{
    if ((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k') {event.preventDefault();$('search').focus();}
    if (event.key==='Escape') document.querySelectorAll('.popover-menu[open]').forEach(menu=>menu.open=false);
  });
  document.addEventListener('pointerdown',event=>document.querySelectorAll('.popover-menu[open]').forEach(menu=>{if(!menu.contains(event.target))menu.open=false;}));
  new ResizeObserver(fitRows).observe(document.querySelector('.table-wrap'));
  window.reportDashboard={update,matches,visible,confirmed,sync,fitRows,clear};
})();
