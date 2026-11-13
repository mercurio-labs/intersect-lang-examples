// Handwritten query UI. All validation, navigation, filtering and derived reads
// execute in the shared Rust query engine through the existing worker transport.
export function createQueryPane(getClient, navigate, config = {}) {
  const panel = document.createElement('section');
  panel.className = 'panel query-panel'; panel.dataset.usage = ''; panel.hidden = true;
  panel.innerHTML = `
    <div class="panel-heading"><div><h2>Model queries</h2><span class="count" id="query-count">Ready</span></div><button id="query-run" class="primary" disabled>Run query</button></div>
    <p class="query-description">Explore the current model, follow references, and read computed properties.</p>
    <div class="query-presets" aria-label="Query examples"><button data-query-preset="available">Available copies</button><button data-query-preset="loans">Loans and borrowers</button><button data-query-preset="libraries">Libraries with available copies</button></div>
    <div class="query-controls">
      <label>Model type<select id="query-class" disabled></select></label>
      <label class="query-wide">Result fields<input id="query-columns" value="$id, name" placeholder="$id, name, copy.title" spellcheck="false"></label>
      <label>Filter field<input id="query-field" list="query-features" placeholder="Optional" spellcheck="false"></label>
      <label>Comparison<select id="query-operator"><option value="eq">equals</option><option value="ne">does not equal</option><option value="lt">less than</option><option value="le">at most</option><option value="gt">greater than</option><option value="ge">at least</option></select></label>
      <label>Value<input id="query-value" placeholder="true, 2, or a name" spellcheck="false"></label>
      <label>Order by<input id="query-order" list="query-features" placeholder="Insertion order" spellcheck="false"></label>
      <label>Direction<select id="query-direction"><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
      <label>Maximum rows<input id="query-limit" type="number" min="1" max="1000" value="50"></label>
    </div>
    <datalist id="query-features"></datalist>
    <p id="query-filter-summary" class="query-description" hidden></p>
    <p id="query-status" class="query-status" role="status">Compile a language and open Usage to query its model.</p>
    <div id="query-results" class="query-results"><p class="empty">Choose fields or an example, then run a query.</p></div>
    <details class="query-advanced"><summary>Query plan and parameters</summary><p>Editable JSON uses the same plan as the typed Rust API. Use count, any/all, Boolean filters, and parameter expressions here.</p><label>Query plan<textarea id="query-plan" rows="14" spellcheck="false" aria-label="Query plan"></textarea></label><label>Parameters (JSON)<textarea id="query-parameters" rows="3" spellcheck="false" aria-label="Query parameters">{}</textarea></label><button id="query-run-plan">Run JSON plan</button></details>`;
  const prefix = config.prefix || '';
  for (const element of panel.querySelectorAll('[id]')) element.id = prefix + element.id;
  for (const element of panel.querySelectorAll('[list]')) element.setAttribute('list', prefix + element.getAttribute('list'));
  (config.host || document.querySelector('main')).append(panel);
  const $ = id => panel.querySelector('#' + prefix + id);
  let schema = null, epoch = 0, ready = false, customFilter = null, imported = false;
  const field = path => ({ op: 'field', path });
  const literal = value => ({ op: 'literal', value });
  const compare = (path, value) => ({ op: 'compare', left: field(path), comparison: 'eq', right: literal(value) });
  function markPreset(preset = '') {
    for (const button of panel.querySelectorAll('[data-query-preset]')) button.setAttribute('aria-pressed', String(button.dataset.queryPreset === preset));
    $('query-filter-summary').hidden = !customFilter;
    $('query-filter-summary').textContent = customFilter ? 'Filter: at least one copy in the library is available.' : '';
  }
  function features(name, seen = new Set()) {
    if (!schema || seen.has(name)) return {};
    seen.add(name); const cls = schema.classes[name];
    return cls ? { ...Object.assign({}, ...cls.parents.map(parent => features(parent, seen))), ...cls.features } : {};
  }
  function updateFeatures() {
    $('query-features').replaceChildren(...['$id', '$class', '$resource', ...Object.keys(features($('query-class').value))].map(name => {
      const option = document.createElement('option'); option.value = name; return option;
    }));
  }
  function value() {
    const input = $('query-value').value;
    const decimal = input.trim();
    // Preserve the exact decimal text; Rust validates the signed integer codec.
    if (/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/.test(decimal)) return { kind: 'int64', value: decimal };
    try { return JSON.parse(input); } catch { return input; }
  }
  function plan() {
    if (!schema) throw new Error('Compile a language before querying.');
    const names = $('query-columns').value.split(',').map(s => s.trim()).filter(Boolean);
    const filterPath = $('query-field').value.trim();
    const orderPath = $('query-order').value.trim();
    return {
      schema_uri: schema.uri, schema_revision: schema.revision, from: $('query-class').value,
      filter: customFilter || (filterPath ? { ...compare(filterPath, value()), comparison: $('query-operator').value } : null),
      select: names.map(name => ({ name, expression: field(name) })),
      order_by: orderPath ? [{ expression: field(orderPath), descending: $('query-direction').value === 'desc' }] : [],
      limit: Number($('query-limit').value),
    };
  }
  function showPlan() { if (schema) $('query-plan').value = JSON.stringify(plan(), null, 2); }
  function invalidate(message) {
    epoch += 1; $('query-count').textContent = 'Ready';
    $('query-status').textContent = message; $('query-status').classList.remove('query-error');
    $('query-results').replaceChildren();
  }
  function configure(pkg) {
    schema = pkg.schema;
    const previous = $('query-class').value;
    $('query-class').replaceChildren(...Object.keys(schema.classes).map(name => {
      const option = document.createElement('option'); option.value = name; option.textContent = name; return option;
    }));
    $('query-class').value = schema.classes[previous] ? previous : Object.keys(schema.classes)[0];
    $('query-class').disabled = false;
    customFilter = null; markPreset(); updateFeatures(); showPlan();
    $('query-run').disabled = !ready; $('query-run-plan').disabled = !ready;
    for (const button of panel.querySelectorAll('[data-query-preset]')) button.disabled = !['BookCopy', 'Loan', 'Library', 'Member'].every(c => schema.classes[c]);
    invalidate('Language ready. Configure a query or choose an example.');
  }
  function render(result) {
    const table = document.createElement('table'); const head = table.createTHead().insertRow();
    for (const column of result.columns) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = column; head.append(th); }
    const body = table.createTBody();
    for (const values of result.rows) {
      const row = body.insertRow();
      values.forEach((value, i) => {
        const cell = row.insertCell();
        if (!imported && result.columns[i] === '$id' && typeof value === 'string') {
          const button = document.createElement('button'); button.className = 'text-button'; button.textContent = value; button.onclick = () => navigate(value); cell.append(button);
        } else cell.textContent = value === null ? '—' : typeof value === 'string' ? value : value?.kind === 'int64' && typeof value.value === 'string' ? value.value : JSON.stringify(value);
      });
    }
    $('query-results').replaceChildren(table);
    if (!result.rows.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No matching elements.'; $('query-results').append(empty); }
    const count = `${result.rows.length} ${result.rows.length === 1 ? 'row' : 'rows'}`;
    $('query-count').textContent = count;
    $('query-status').textContent = `${count}${result.has_more ? ' · More matches exist; increase the limit or narrow the query.' : ' · Complete result.'} ${result.stats.candidates} candidates · ${result.stats.reads} work units · model generation ${result.generation}.`;
  }
  async function run(advanced = false) {
    const token = ++epoch;
    $('query-run').disabled = true; $('query-run-plan').disabled = true;
    $('query-results').replaceChildren(); $('query-count').textContent = 'Running';
    $('query-status').textContent = 'Running query…'; $('query-status').classList.remove('query-error');
    try {
      const query = advanced ? JSON.parse($('query-plan').value) : plan();
      if (!advanced) $('query-plan').value = JSON.stringify(query, null, 2);
      const parameters = JSON.parse($('query-parameters').value);
      const state = await getClient().request('intersect/inspect');
      const result = await getClient().request('intersect/query', { query, parameters, interfaceRevision: state.interfaceRevision, generation: state.generation });
      if (token !== epoch) return;
      render(result);
    } catch (error) {
      if (token !== epoch) return;
      $('query-count').textContent = 'Not run'; $('query-status').textContent = error.message; $('query-status').classList.add('query-error');
    } finally { $('query-run').disabled = !ready || !schema; $('query-run-plan').disabled = !ready || !schema; }
  }
  $('query-run').onclick = () => run(); $('query-run-plan').onclick = () => run(true);
  $('query-run-plan').disabled = true;
  for (const input of panel.querySelectorAll('.query-controls input, .query-controls select')) input.addEventListener('input', () => {
    if (['query-class', 'query-field', 'query-operator', 'query-value'].includes(input.id.slice(prefix.length))) { customFilter = null; markPreset(); }
    pendingState = null; updateFeatures(); showPlan(); invalidate('Query changed. Run to refresh results.');
  });
  for (const button of panel.querySelectorAll('[data-query-preset]')) {
    button.disabled = true;
    button.onclick = () => {
      const preset = button.dataset.queryPreset;
      $('query-field').value = ''; $('query-value').value = ''; $('query-order').value = 'name'; $('query-direction').value = 'asc'; $('query-limit').value = '50'; $('query-operator').value = 'eq'; customFilter = null;
      if (preset === 'available') {
        $('query-class').value = 'BookCopy'; $('query-columns').value = '$id, name, title, edition, available'; $('query-field').value = 'available'; $('query-value').value = 'true';
      } else if (preset === 'loans') {
        $('query-class').value = 'Loan'; $('query-columns').value = '$id, name, copy.title, member.name';
      } else {
        $('query-class').value = 'Library'; $('query-columns').value = '$id, name, copyCount';
        customFilter = { op: 'any', path: 'copies', predicate: compare('available', true) };
      }
      markPreset(preset); updateFeatures(); showPlan(); invalidate('Example loaded. Run query to see results.');
    };
  }
  const fields = ['class', 'columns', 'field', 'operator', 'value', 'order', 'direction', 'limit', 'plan', 'parameters'];
  let pendingState = null;
  function restore(state) {
    for (const key of fields) {
      const input = $('query-' + key);
      if (key === 'class' && state[key] && ![...input.options].some(o => o.value === state[key])) input.add(new Option(state[key], state[key]));
      if (typeof state[key] === 'string') input.value = state[key];
    }
    customFilter = state.customFilter || null;
    markPreset(); updateFeatures(); invalidate('Query restored. Run to refresh results.');
    pendingState = state;
  }
  return {
    panel,
    clearDraft() {
      pendingState = null; customFilter = null; schema = null; ready = false;
      $('query-class').replaceChildren();
      for (const [key, value] of Object.entries({ columns: '$id, name', field: '', operator: 'eq', value: '', order: '', direction: 'asc', limit: '50', plan: '', parameters: '{}' })) $('query-' + key).value = value;
      markPreset(); invalidate('Compile a metamodel to query its instances.');
    },
    snapshot: () => ({ ...Object.fromEntries(fields.map(key => [key, $('query-' + key).value])), customFilter }),
    restore,
    dispose() { epoch += 1; panel.remove(); },
    configure(pkg) { const saved = pendingState; configure(pkg); if (saved) { restore(saved); pendingState = null; } },
    changed(result) { imported = result.modelOrigin === 'import'; ready = result.documentAnalysisValid !== false && result.diagnostics.length === 0; invalidate(ready ? 'Model changed. Run to query the current values.' : 'Fix model diagnostics before querying.'); $('query-run').disabled = !ready || !schema; $('query-run-plan').disabled = !ready || !schema; },
    reset() { ready = false; schema = null; customFilter = null; invalidate('Runtime restarting. Compile a language to query.'); $('query-run').disabled = true; $('query-run-plan').disabled = true; $('query-class').disabled = true; for (const b of panel.querySelectorAll('[data-query-preset]')) b.disabled = true; },
  };
}
