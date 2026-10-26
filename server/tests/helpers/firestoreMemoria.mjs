import assert from 'node:assert/strict';

/** Transações serializadas, com rollback e proibição de leituras depois de escritas. */
export function firestoreMemoria(iniciais = []) {
  const data = new Map(structuredClone(iniciais));
  let seq = 0, fila = Promise.resolve();
  const snapshot = r => ({ id: r.id, ref: r, exists: data.has(r.path), data: () => structuredClone(data.get(r.path)) });
  const ref = path => ({ path, id: path.split('/').at(-1), get: async () => snapshot(ref(path)), collection: nome => collection(`${path}/${nome}`) });
  const collection = path => {
    const consulta = (filtros = [], limite = Infinity) => ({
      doc: id => ref(`${path}/${id || `id${++seq}`}`),
      where: (campo, op, valor) => { assert.ok(['==', '>=', '<'].includes(op), op); return consulta([...filtros, [campo, op, valor]], limite); },
      limit: n => consulta(filtros, n),
      get: async () => ({ docs: [...data].filter(([k, v]) => k.startsWith(`${path}/`) && k.split('/').length === path.split('/').length + 1 && filtros.every(([campo, op, valor]) => op === '>=' ? v[campo] >= valor : op === '<' ? v[campo] < valor : v[campo] === valor)).slice(0, limite).map(([k]) => snapshot(ref(k))) }),
    });
    return consulta();
  };
  const db = { collection, doc: ref, runTransaction(fn) {
    const executar = async () => {
      const escritas = []; let escrevendo = false;
      const resultado = await fn({
        get: async r => { assert.equal(escrevendo, false, 'todas as leituras devem preceder as escritas'); return r.path ? snapshot(r) : r.get(); },
        set: (r, value, options) => { escrevendo = true; escritas.push(() => data.set(r.path, structuredClone(options?.merge ? { ...data.get(r.path), ...value } : value))); },
        update: (r, value) => { escrevendo = true; escritas.push(() => { assert.ok(data.has(r.path), r.path); data.set(r.path, structuredClone({ ...data.get(r.path), ...value })); }); },
        delete: r => { escrevendo = true; escritas.push(() => data.delete(r.path)); },
      });
      const antes = structuredClone([...data]);
      try { escritas.forEach(fn => fn()); } catch (e) { data.clear(); antes.forEach(([k, v]) => data.set(k, v)); throw e; }
      return resultado;
    };
    const atual = fila.then(executar); fila = atual.catch(() => {}); return atual;
  } };
  return { db, data };
}
