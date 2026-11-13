// Read-only presentation of the published model and its compiled schema.
// Containment declarations come from the shared runtime, never from ID shapes.
export function createModelTree(host, detailHost, onInspect = () => {}, resourceLabel = uri => uri.split('/').at(-1) || uri) {
  const collapsed = new Set();
  let selected = null;
  let result = null;
  let schema = null;
  let nodes = new Map();
  let elements = new Map();
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const classLabel = element => schema?.declarations?.[element.class]?.name || element.class;
  const label = element => String(element.values.name || element.values.title || element.id);
  const key = id => `element:${id}`;
  const tree = make('div', 'instance-tree');
  tree.setAttribute('role', 'tree'); tree.setAttribute('aria-label', 'Model containment tree');
  const detail = make('section', 'instance-properties');
  detail.setAttribute('aria-label', 'Instance properties');
  detailHost.append(detail);

  function features(className) {
    const chain = []; const seen = new Set();
    function visit(name) {
      const cls = schema?.classes[name];
      if (!cls || seen.has(name)) return;
      seen.add(name);
      cls.parents.forEach(visit);
      chain.push(cls);
    }
    visit(className);
    return Object.assign({}, ...chain.map(cls => cls.features));
  }
  function displayValue(value) {
    if (Array.isArray(value)) return `[${value.map(displayValue).join(', ')}]`;
    if (value?.kind === 'int64' && typeof value.value === 'string') return value.value;
    if (value?.kind === 'enum') {
      const same = (a, b) => a && b && a.source.uri === b.source.uri && a.source.sha256 === b.source.sha256 && JSON.stringify(a.path) === JSON.stringify(b.path);
      const enumeration = Object.values(schema?.enumerations || {}).find(item => same(item.declaration, value.enumeration));
      const literal = enumeration?.literals.find(item => same(item.declaration, value.literal));
      if (literal) return `${enumeration.name}.${literal.name}`;
    }
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  function visible() { return [...tree.querySelectorAll('[role="treeitem"]')].filter(node => !node.parentElement.closest('[hidden]')); }
  function select(id, focus = false) {
    selected = id;
    for (const [nodeKey, entry] of nodes) {
      entry.dom.setAttribute('aria-selected', String(id === nodeKey));
      entry.dom.tabIndex = id === nodeKey ? 0 : -1;
    }
    showProperties(nodes.get(id));
    if (focus) { onInspect(); nodes.get(id)?.dom.focus(); nodes.get(id)?.dom.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }
  function expand(entry, open) {
    if (!entry.group) return;
    if (open) collapsed.delete(entry.key); else collapsed.add(entry.key);
    entry.group.hidden = !open;
    entry.dom.setAttribute('aria-expanded', String(open));
    entry.chevron.textContent = open ? '▾' : '▸';
  }
  function reveal(id) {
    const entry = nodes.get(key(id));
    if (!entry) return;
    for (let parent = entry.parent; parent; parent = parent.parent) expand(parent, true);
    select(entry.key, true);
  }
  function showProperties(entry) {
    detail.replaceChildren(make('h3', 'structure-section-heading', 'PROPERTIES'));
    if (!entry?.element) {
      detail.append(make('p', 'instance-help', entry ? entry.resource : 'Select an instance to inspect its properties.'));
      return;
    }
    const element = entry.element;
    detail.append(make('h4', '', label(element)), make('p', 'instance-kind', classLabel(element)));
    const metadata = features(element.class);
    const list = make('dl', 'instance-values');
    function property(name, value, reference = false, derived = false) {
      const term = make('dt', '', `${name}${derived ? ' · derived' : ''}`);
      const description = make('dd');
      const values = reference ? (Array.isArray(value) ? value : value == null ? [] : [value]) : [];
      if (reference && values.length) {
        for (const id of values) {
          const target = elements.get(id);
          if (target) {
            const link = make('button', 'instance-reference', `${label(target)} · ${classLabel(target)}`);
            link.title = id; link.onclick = () => reveal(id); description.append(link);
          } else description.append(make('code', '', String(id)));
        }
      } else {
        description.textContent = displayValue(value);
        if (value && typeof value === 'object') description.title = JSON.stringify(value);
      }
      list.append(term, description);
    }
    for (const [name, value] of Object.entries(element.values)) property(name, value, metadata[name]?.reference);
    for (const [name, value] of Object.entries(result.derived[element.id] || {})) property(name, value, metadata[name]?.reference, true);
    property('Identity', element.id); property('Type identity', element.type_identity); property('Resource', element.resource);
    detail.append(list);
  }
  function render() {
    if (!result) return;
    const previousFocus = tree.contains(document.activeElement);
    const scrollTop = tree.scrollTop;
    nodes = new Map(); elements = new Map(result.model.elements.map(element => [element.id, element]));
    tree.replaceChildren();
    if (!elements.size) {
      host.replaceChildren(make('div', 'empty', 'No constructed elements. Check the model diagnostics.'));
      selected = null; showProperties(null); return;
    }
    host.replaceChildren(tree);
    const children = new Map(); const parents = new Map();
    for (const element of elements.values()) {
      const contained = [];
      for (const feature of Object.values(features(element.class))) {
        if (!feature.reference || !feature.containment || feature.derived) continue;
        const value = element.values[feature.name];
        for (const id of Array.isArray(value) ? value : value == null ? [] : [value]) {
          if (elements.has(id) && !parents.has(id)) { contained.push({ id, feature: feature.name }); parents.set(id, element.id); }
        }
      }
      children.set(element.id, contained);
    }
    const rendered = new Set();
    function row(nodeKey, parent, level, element, resource, feature) {
      const dom = make('div', 'instance-node');
      dom.setAttribute('role', 'treeitem'); dom.setAttribute('aria-level', String(level));
      dom.setAttribute('aria-label', element ? `${label(element)} · ${classLabel(element)}` : resource);
      if (element) dom.dataset.elementId = element.id; else dom.dataset.resource = resource;
      const line = make('div', 'instance-row'); line.style.setProperty('--depth', level - 1);
      const chevron = make('span', 'instance-chevron', ''); chevron.setAttribute('aria-hidden', 'true');
      line.append(chevron, make('span', 'structure-node-icon', element ? classLabel(element)[0] : 'R'), make('span', 'instance-name', element ? label(element) : resourceLabel(resource)));
      line.title = element ? element.id : resource;
      if (element) {
        line.append(make('span', 'instance-class', classLabel(element)));
        if (feature) line.append(make('span', 'instance-feature', feature));
        for (const [name, value] of Object.entries(result.derived[element.id] || {})) line.append(make('span', 'instance-derived', `${name}: ${JSON.stringify(value)}`));
      }
      dom.append(line);
      const entry = { key: nodeKey, dom, parent, element, resource, chevron };
      nodes.set(nodeKey, entry);
      dom.addEventListener('focus', () => { if (selected !== nodeKey) select(nodeKey); });
      line.onclick = event => {
        if (event.target === chevron) expand(entry, collapsed.has(nodeKey));
        select(nodeKey, true);
      };
      return entry;
    }
    function appendElement(id, parent, container, level, feature) {
      if (rendered.has(id)) return;
      rendered.add(id);
      const element = elements.get(id);
      const entry = row(key(id), parent, level, element, element.resource, feature);
      container.append(entry.dom);
      const nested = children.get(id).filter(child => !rendered.has(child.id));
      if (nested.length) {
        entry.group = make('div', 'instance-group'); entry.group.setAttribute('role', 'group'); entry.dom.append(entry.group);
        for (const child of nested) appendElement(child.id, entry, entry.group, level + 1, child.feature);
        expand(entry, !collapsed.has(entry.key));
      }
    }
    const resources = new Map();
    function appendRoot(element) {
      let resource = resources.get(element.resource);
      if (!resource) {
        resource = row(`resource:${element.resource}`, null, 1, null, element.resource);
        resource.group = make('div', 'instance-group'); resource.group.setAttribute('role', 'group'); resource.dom.append(resource.group);
        resources.set(element.resource, resource); tree.append(resource.dom);
        expand(resource, !collapsed.has(resource.key));
      }
      appendElement(element.id, resource, resource.group, 2);
    }
    for (const element of elements.values()) if (!parents.has(element.id)) appendRoot(element);
    // Keep any incomplete/invalid published objects inspectable without looping.
    for (const element of elements.values()) if (!rendered.has(element.id)) appendRoot(element);
    for (const id of collapsed) if (!nodes.has(id)) collapsed.delete(id);
    let target = nodes.get(selected) || [...nodes.values()].find(entry => entry.element);
    for (let parent = target?.parent; parent; parent = parent.parent) if (collapsed.has(parent.key)) target = parent;
    select(target?.key, previousFocus);
    tree.scrollTop = scrollTop;
  }
  tree.addEventListener('keydown', event => {
    const entry = nodes.get(selected);
    if (!entry || !['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    const rows = visible(); const index = rows.indexOf(entry.dom);
    const at = index => { const dom = rows[index]; if (dom) select([...nodes.values()].find(node => node.dom === dom).key, true); };
    if (event.key === 'ArrowDown') at(Math.min(rows.length - 1, index + 1));
    else if (event.key === 'ArrowUp') at(Math.max(0, index - 1));
    else if (event.key === 'Home') at(0);
    else if (event.key === 'End') at(rows.length - 1);
    else if (event.key === 'ArrowRight') { if (collapsed.has(entry.key)) expand(entry, true); else if (entry.group) at(index + 1); }
    else if (event.key === 'ArrowLeft') { if (entry.group && !collapsed.has(entry.key)) expand(entry, false); else if (entry.parent) select(entry.parent.key, true); }
    else if (entry.group) expand(entry, collapsed.has(entry.key));
  });
  return {
    update(next, compiledSchema) {
      result = next;
      // Model notifications can arrive before the compile response. Only use
      // metadata from the matching compiled revision, then redraw on response.
      schema = compiledSchema?.revision === next.model.schema_revision ? compiledSchema : null;
      render();
    },
    reset() { result = null; selected = null; collapsed.clear(); nodes.clear(); elements.clear(); showProperties(null); host.replaceChildren(make('div', 'empty', 'Starting a fresh runtime…')); },
  };
}
