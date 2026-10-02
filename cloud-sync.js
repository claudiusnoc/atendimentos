/* Small, testable optimistic-concurrency adapter. Never upsert an old report. */
(function (root) {
  const columns = ['site', 'priority', 'quantity', 'technician', 'base', 'failure', 'status', 'notes', 'voltage', 'ordem'];
  const select = 'id,' + columns.join(',') + ',updated_at';
  const equal = (a, b) => (a ?? '') === (b ?? '');
  class Conflict extends Error {
    constructor(id, fields, remote) {
      super(remote ? `Outra sessão alterou: ${fields.join(', ')}.` : 'Esta linha foi removida em outra sessão.');
      this.name = 'SyncConflict'; this.id = id; this.fields = fields; this.remote = remote;
    }
  }
  function payload(record, order) {
    const voltage = String(record.voltage || '').trim().replace(/\s*v$/i, '').replace(',', '.');
    if (voltage && (!/^\d+(?:\.\d+)?$/.test(voltage) || Number(voltage) >= 100000)) throw new Error('Confira a tensão digitada.');
    return Object.fromEntries(columns.map(key => [key, key === 'ordem' ? order : key === 'voltage' ? (voltage ? Number(voltage) : null) : String(record[key] || '').trim()]));
  }
  function plan(base, remote, patch) {
    if (!remote) throw new Conflict(base.id, ['linha removida'], null);
    const conflicts = Object.keys(patch).filter(key => !equal(base[key], remote[key]) && !equal(patch[key], remote[key]));
    if (conflicts.length) throw new Conflict(base.id, conflicts, remote);
    return Object.fromEntries(Object.entries(patch).filter(([key, value]) => !equal(value, remote[key])));
  }
  async function commit(client, operation) {
    const { id, base, patch, deleted } = operation;
    for (let attempt = 0; attempt < 3; attempt++) {
      const found = await client.from('atendimentos').select(select).eq('id', id).maybeSingle();
      if (found.error) throw found.error;
      const remote = found.data;
      if (!base) {
        if (deleted) return null;
        // A lost INSERT response is retried with the same UUID, not a second row.
        if (remote) {
          if (Object.entries(patch).every(([key, value]) => equal(value, remote[key]))) return remote;
          throw new Conflict(id, Object.keys(patch), remote);
        }
        const created = await client.from('atendimentos').insert({ id, ...patch }).select(select).single();
        if (created.error?.code === '23505') continue;
        if (created.error) throw created.error;
        return created.data;
      }
      if (deleted && !remote) return null;
      if (!remote) throw new Conflict(id, ['linha removida'], null);
      if (!remote.updated_at) throw new Error('Não foi possível verificar a versão da linha.');
      if (deleted) {
        if (!columns.every(key => equal(base[key], remote[key]))) throw new Conflict(id, ['linha alterada antes da exclusão'], remote);
        const result = await client.from('atendimentos').delete().eq('id', id).eq('updated_at', remote.updated_at).select('id');
        if (result.error) throw result.error;
        if (result.data?.length) return null;
      } else {
        const changes = plan(base, remote, patch);
        if (!Object.keys(changes).length) return remote;
        const result = await client.from('atendimentos').update(changes).eq('id', id).eq('updated_at', remote.updated_at).select(select).maybeSingle();
        if (result.error) throw result.error;
        if (result.data) return result.data;
      }
    }
    throw new Error('O relatório está sendo alterado em outra sessão. Tente sincronizar novamente.');
  }
  const api = { columns, select, equal, payload, plan, commit, Conflict };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReportSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
