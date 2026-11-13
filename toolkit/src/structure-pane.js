import './structure-pane.css';
import { copyDiagram } from './diagram-clipboard.js';
import { createPaneSplitters } from './pane-splitters.js';

// This host renders the shared Rust definition description. XML interpretation
// and all definition edits belong to intersect-model, behind the worker.
const CARD_WIDTH = 224;
const HEADER_HEIGHT = 43;
const ROW_HEIGHT = 27;
const SVG_NS = 'http://www.w3.org/2000/svg';
const primitiveTypes = ['EString', 'EBoolean', 'EByte', 'EShort', 'EInt', 'ELong', 'EFloat', 'EDouble', 'EChar', 'EByteArray', 'EBigInteger', 'EBigDecimal', 'EDate', 'EBooleanObject', 'EByteObject', 'EShortObject', 'EIntegerObject', 'ELongObject', 'EFloatObject', 'EDoubleObject', 'ECharacterObject'];
let nextPaneId = 0;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, action, className = '') {
  const node = element('button', className, text);
  node.type = 'button'; node.onclick = action;
  return node;
}
function svgElement(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}
function multiplicity(feature) {
  const upper = feature.upper === -1 ? '*' : feature.upper;
  return `${feature.lower}..${upper}`;
}
function classHeight(cls) { return HEADER_HEIGHT + Math.max(1, (cls.features || cls.literals).length + (cls.operations || []).length) * ROW_HEIGHT + 8; }
function sameSelection(a, b) { return a?.class === b?.class && a?.feature === b?.feature && a?.operation === b?.operation && a?.enumeration === b?.enumeration && a?.literal === b?.literal && a?.draft === b?.draft; }
function operationType(value) {
  const target = value.target;
  const name = !target ? 'void' : typeof target.name === 'string' ? target.name : JSON.stringify(target.name);
  return `${name}${target ? ` [${value.lower}..${value.upper === -1 ? '*' : value.upper}]` : ''}`;
}
function operationSignature(operation) {
  return `${operation.name}(${operation.parameters.map(parameter => `${parameter.name}: ${operationType(parameter.value)}`).join(', ')}): ${operationType(operation.result)}`;
}
function errorText(error) { return error?.message || String(error); }
function changedFields(values, original) {
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(original[key] ?? null)));
}

/** Monaco is the sole source document; diagram layout is a separate host artifact. */
export function createStructurePane({ host, model, request, onSource, readOnly = () => false, autoRefresh = true }) {
  const paneId = `structure-${++nextPaneId}`;
  let description = null;
  let inspectedSource = null;
  let selection = {};
  let positions = new Map();
  let zoom = 1;
  let generation = 0;
  let editInFlight = false;
  let copying = false;
  let destroyed = false;
  let refreshTimer;
  let drag = null;
  let canvasWidth = 900;
  let canvasHeight = 520;
  const cards = new Map();
  const rows = [];

  host.classList.add('structure-pane');
  host.replaceChildren();
  const toolbar = element('div', 'structure-toolbar');
  const editorActions = element('div', 'structure-actions');
  const addClass = button('+ Class', () => choose({ draft: 'class' }));
  addClass.setAttribute('aria-label', 'Add class');
  const addEnum = button('+ Enum', () => choose({ draft: 'enum' }));
  addEnum.setAttribute('aria-label', 'Add enum');
  const addLiteral = button('+ Literal', () => choose({ enumeration: selection.enumeration, draft: 'literal' }));
  addLiteral.setAttribute('aria-label', 'Add literal');
  const addAttribute = button('+ Attribute', () => choose({ class: selection.class, draft: 'attribute' }));
  addAttribute.setAttribute('aria-label', 'Add attribute');
  const addReference = button('+ Reference', () => choose({ class: selection.class, draft: 'reference' }));
  addReference.setAttribute('aria-label', 'Add reference');
  editorActions.append(addClass, addEnum, addAttribute, addReference, addLiteral);
  const diagramActions = element('div', 'structure-actions');
  const autoLayout = button('Auto-layout', () => { positions.clear(); placeClasses(); renderDiagram(); });
  const copy = button('Copy diagram', async () => {
    if (!isCurrent() || copying) return;
    const version = model.getVersionId();
    copying = true; copy.textContent = 'Copying…'; updateActions();
    try {
      await copyDiagram(canvas, edges, canvasWidth, canvasHeight, zoom);
      if (!destroyed && model.getVersionId() === version) report('Diagram copied to clipboard as PNG.');
    } catch (error) { if (!destroyed && model.getVersionId() === version) report(errorText(error), true); }
    finally { copying = false; if (!destroyed) { copy.textContent = 'Copy diagram'; updateActions(); } }
  });
  copy.title = 'Copy the complete class diagram as a PNG image';
  const fitDiagram = button('Fit', () => {
    setZoom(Math.min(1, (viewport.clientWidth - 16) / canvasWidth, (viewport.clientHeight - 16) / canvasHeight));
    viewport.scrollTo(0, 0);
  });
  fitDiagram.setAttribute('aria-label', 'Fit diagram to view');
  fitDiagram.title = 'Fit within the supported 50–150% zoom range';
  const zoomOut = button('−', () => setZoom(zoom - 0.1)); zoomOut.setAttribute('aria-label', 'Zoom diagram out');
  const zoomLabel = element('output', 'structure-zoom', '100%'); zoomLabel.setAttribute('aria-label', 'Diagram zoom');
  const zoomIn = button('+', () => setZoom(zoom + 0.1)); zoomIn.setAttribute('aria-label', 'Zoom diagram in');
  diagramActions.append(copy, autoLayout, fitDiagram, zoomOut, zoomLabel, zoomIn);
  editorActions.hidden = readOnly();
  toolbar.append(editorActions, diagramActions);
  const message = element('div', 'structure-message', 'Reading structure…');
  message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  const body = element('div', 'structure-body');
  const treePanel = element('section', 'structure-tree-panel');
  treePanel.append(element('h3', 'structure-section-heading', 'CONTAINMENT'));
  const tree = element('div', 'structure-tree'); tree.setAttribute('role', 'tree'); tree.setAttribute('aria-label', 'Structure containment tree');
  treePanel.append(tree);
  const diagramPanel = element('section', 'structure-diagram-panel');
  const diagramHeading = element('div', 'structure-diagram-heading');
  diagramHeading.append(element('h3', 'structure-section-heading', 'CLASS DIAGRAM'), element('span', 'structure-diagram-help', 'Edit Rcore source · move headers to arrange'));
  const viewport = element('div', 'structure-viewport');
  viewport.setAttribute('aria-label', 'Generated class diagram');
  viewport.tabIndex = 0;
  const stage = element('div', 'structure-stage');
  const canvas = element('div', 'structure-canvas');
  const edges = svgElement('svg', { class: 'structure-edges', 'aria-label': 'Class relationships', role: 'img' });
  const cardLayer = element('div', 'structure-cards');
  canvas.append(edges, cardLayer); stage.append(canvas); viewport.append(stage);
  const legend = element('div', 'structure-legend', '◆ Containment   → Reference   △ Inheritance');
  diagramPanel.append(diagramHeading, viewport, legend);
  const propertiesPanel = element('section', 'structure-properties-panel');
  propertiesPanel.append(element('h3', 'structure-section-heading', 'PROPERTIES'));
  const properties = element('div', 'structure-properties');
  propertiesPanel.append(properties);
  body.append(treePanel, diagramPanel, propertiesPanel);
  [treePanel, diagramPanel, propertiesPanel].forEach((panel, index) => panel.id = `${paneId}-panel-${index}`);
  host.append(toolbar, message, body);
  const splitters = createPaneSplitters(body, [treePanel, diagramPanel, propertiesPanel]);

  function report(text, error = false) {
    message.textContent = text; message.classList.toggle('structure-error', error);
    message.classList.remove('structure-warning');
  }
  function isCurrent() { return description && inspectedSource === model.getValue(); }
  function updateActions() {
    const locked = readOnly() || !isCurrent() || editInFlight;
    addClass.disabled = locked;
    addEnum.disabled = locked;
    addLiteral.disabled = locked || !selectedEnum();
    addAttribute.disabled = locked || !selection.class;
    addReference.disabled = locked || !selection.class;
    autoLayout.disabled = !description;
    fitDiagram.disabled = !description;
    copy.disabled = !isCurrent() || editInFlight || copying || !classifiers().length;
    properties.querySelectorAll('.structure-property-actions').forEach(actions => { actions.hidden = readOnly(); });
    properties.querySelectorAll('button, input, select').forEach(control => { control.disabled = locked || control.dataset.readonly === 'true'; });
  }
  function describeStatus() {
    const warnings = description.warnings || [];
    if (warnings.length) report(`Source preserved. ${warnings.map(w => typeof w === 'string' ? w : w.message || JSON.stringify(w)).join(' ')}`);
    else report(`${description.classes.length} classes${description.enums?.length ? ` · ${description.enums.length} enums` : ''} · Generated structure · Diagram layout is saved separately.`);
    message.classList.toggle('structure-warning', warnings.length > 0);
  }
  function selectedClass() { return description?.classes.find(cls => cls.name === selection.class); }
  function selectedEnum() { return description?.enums?.find(item => item.name === selection.enumeration); }
  function classifiers() { return [...(description?.classes || []), ...(description?.enums || []).map(item => ({ ...item, isEnum: true }))]; }
  function attributeTypes() { return [...primitiveTypes, ...(description?.enums || []).filter(item => !item.name.includes('/')).map(item => item.name)]; }
  function classifierSelection(cls) { return cls.isEnum ? { enumeration: cls.name } : { class: cls.name }; }
  function choose(next, reveal = true) {
    selection = next; renderSelection(); renderProperties(); updateActions();
    if (reveal) revealSelection();
  }
  function revealSelection() {
    const cls = selectedClass() || selectedEnum();
    const position = cls && positions.get(cls.name);
    if (!position || !viewport.clientWidth) return;
    const left = position.x * zoom; const top = position.y * zoom;
    const right = left + CARD_WIDTH * zoom; const bottom = top + classHeight(cls) * zoom;
    if (left < viewport.scrollLeft + 16) viewport.scrollLeft = left - 16;
    else if (right > viewport.scrollLeft + viewport.clientWidth - 16) viewport.scrollLeft = right - viewport.clientWidth + 16;
    if (top < viewport.scrollTop + 16) viewport.scrollTop = top - 16;
    else if (bottom > viewport.scrollTop + viewport.clientHeight - 16) viewport.scrollTop = bottom - viewport.clientHeight + 16;
  }
  function renderSelection() {
    for (const { node, target } of rows) node.setAttribute('aria-selected', String(sameSelection(selection, target)));
    for (const [name, card] of cards) {
      card.classList.toggle('is-selected', selection.class === name || selection.enumeration === name);
      card.querySelector('.structure-class-title').setAttribute('aria-pressed', String((selection.class === name && !selection.feature && selection.operation === undefined) || (selection.enumeration === name && !selection.literal)));
      card.querySelectorAll('[data-operation]').forEach(row => row.setAttribute('aria-pressed', String(selection.class === name && selection.operation === Number(row.dataset.operation))));
      card.querySelectorAll('[data-feature]').forEach(row => row.setAttribute('aria-pressed', String(selection.class === name && selection.feature === row.dataset.feature)));
      card.querySelectorAll('[data-literal]').forEach(row => row.setAttribute('aria-pressed', String(selection.enumeration === name && selection.literal === row.dataset.literal)));
    }
  }
  function treeRow(text, target, level, kind) {
    const row = button('', () => choose(target), 'structure-tree-item');
    row.setAttribute('role', 'treeitem'); row.setAttribute('aria-level', String(level));
    row.dataset.level = String(level); row.dataset.kind = kind;
    row.append(element('span', 'structure-node-icon', { package: 'P', class: 'C', attribute: 'a', reference: 'r', enum: 'E', literal: 'v', operation: 'ƒ' }[kind]), element('span', '', text));
    rows.push({ node: row, target }); tree.append(row);
    return row;
  }
  function renderTree() {
    tree.replaceChildren(); rows.length = 0;
    if (!description) return;
    treeRow(description.name || 'Package', {}, 1, 'package').setAttribute('aria-expanded', 'true');
    for (const cls of description.classes) {
      treeRow(cls.name, { class: cls.name }, 2, 'class').setAttribute('aria-expanded', 'true');
      for (const feature of cls.features) treeRow(feature.name, { class: cls.name, feature: feature.name }, 3, feature.kind);
      (cls.operations || []).forEach((operation, index) => treeRow(operationSignature(operation), { class: cls.name, operation: index }, 3, 'operation'));
    }
    for (const enumeration of description.enums || []) {
      treeRow(enumeration.name, { enumeration: enumeration.name }, 2, 'enum').setAttribute('aria-expanded', 'true');
      for (const literal of enumeration.literals) treeRow(literal.name, { enumeration: enumeration.name, literal: literal.name }, 3, 'literal');
    }
  }
  tree.onkeydown = event => {
    const index = rows.findIndex(row => row.node === document.activeElement);
    if (index < 0) return;
    let next = index;
    if (event.key === 'ArrowDown') next = Math.min(index + 1, rows.length - 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = rows.length - 1;
    else if (event.key === 'ArrowRight' && index + 1 < rows.length) next = index + 1;
    else if (event.key === 'ArrowLeft') {
      const level = Number(rows[index].node.dataset.level);
      for (let i = index - 1; i >= 0; i--) if (Number(rows[i].node.dataset.level) < level) { next = i; break; }
    } else return;
    event.preventDefault(); rows[next].node.focus(); choose(rows[next].target);
  };

  function placeClasses() {
    if (!description) return;
    const names = new Set(classifiers().map(cls => cls.name));
    // Keep removed positions until a project is closed: undo restores the layout.
    const existing = classifiers().filter(cls => positions.has(cls.name));
    const bottom = existing.reduce((y, cls) => Math.max(y, positions.get(cls.name).y + classHeight(cls)), 0);
    let column = 0;
    let rowY = bottom ? bottom + 95 : 55;
    let rowHeight = 0;
    const columnCount = names.size <= 2 ? 2 : 3;
    for (const cls of classifiers()) {
      if (positions.has(cls.name)) continue;
      positions.set(cls.name, { x: 48 + column * 310, y: rowY });
      rowHeight = Math.max(rowHeight, classHeight(cls));
      column++;
      if (column === columnCount) { column = 0; rowY += rowHeight + 95; rowHeight = 0; }
    }
  }
  function fitCanvas() {
    canvasWidth = 680; canvasHeight = 410;
    for (const cls of classifiers()) {
      const position = positions.get(cls.name);
      canvasWidth = Math.max(canvasWidth, position.x + CARD_WIDTH + 110);
      canvasHeight = Math.max(canvasHeight, position.y + classHeight(cls) + 100);
    }
    canvas.style.width = `${canvasWidth}px`; canvas.style.height = `${canvasHeight}px`;
    edges.setAttribute('width', canvasWidth); edges.setAttribute('height', canvasHeight);
    stage.style.width = `${canvasWidth * zoom}px`; stage.style.height = `${canvasHeight * zoom}px`;
    canvas.style.transform = `scale(${zoom})`;
    zoomLabel.value = `${Math.round(zoom * 100)}%`;
  }
  function setZoom(next) {
    const previous = zoom;
    zoom = Math.max(0.5, Math.min(1.5, Math.round(next * 10) / 10));
    fitCanvas();
    viewport.scrollLeft = (viewport.scrollLeft + viewport.clientWidth / 2) * zoom / previous - viewport.clientWidth / 2;
    viewport.scrollTop = (viewport.scrollTop + viewport.clientHeight / 2) * zoom / previous - viewport.clientHeight / 2;
  }
  function renderDiagram() {
    cardLayer.replaceChildren(); cards.clear();
    if (!description) { edges.replaceChildren(); return; }
    placeClasses();
    for (const cls of classifiers()) {
      const position = positions.get(cls.name);
      const card = element('div', 'structure-class'); card.dataset.class = cls.name;
      if (cls.isEnum) card.dataset.enum = cls.name;
      card.style.left = `${position.x}px`; card.style.top = `${position.y}px`;
      const heading = button('', () => choose(classifierSelection(cls)), 'structure-class-title');
      heading.setAttribute('aria-label', `${cls.isEnum ? 'Enum' : 'Class'} ${cls.name}. Arrow keys move this element.`);
      heading.append(element('span', 'structure-class-stereotype', cls.isEnum ? 'ENUM' : cls.abstract ? 'ABSTRACT CLASS' : 'CLASS'), element('strong', '', cls.name));
      heading.onpointerdown = event => beginMove(event, cls.name, heading);
      heading.onkeydown = event => {
        const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (!directions[event.key]) return;
        event.preventDefault(); choose(classifierSelection(cls));
        const [dx, dy] = directions[event.key]; const step = event.shiftKey ? 30 : 10;
        const current = positions.get(cls.name);
        moveClass(cls.name, current.x + dx * step, current.y + dy * step);
        revealSelection();
      };
      card.append(heading);
      if (!(cls.features || cls.literals).length && !(cls.operations || []).length) card.append(element('div', 'structure-class-empty', cls.isEnum ? 'No literals' : 'No features'));
      for (const literal of cls.literals || []) {
        const row = button('', () => choose({ enumeration: cls.name, literal: literal.name }), 'structure-feature'); row.dataset.literal = literal.name;
        row.append(element('span', 'structure-feature-icon', '≡'), element('span', 'structure-feature-name', literal.name), element('span', 'structure-multiplicity', String(literal.value)));
        row.title = `Literal spelling: ${JSON.stringify(literal.literal ?? literal.name)}`;
        card.append(row);
      }
      for (const feature of cls.features || []) {
        const row = button('', () => choose({ class: cls.name, feature: feature.name }), 'structure-feature');
        row.dataset.feature = feature.name;
        row.setAttribute('aria-label', `${cls.name}.${feature.name}: ${feature.type}, ${multiplicity(feature)}`);
        row.append(element('span', 'structure-feature-icon', feature.kind === 'reference' ? (feature.containment ? '◇' : '↗') : '·'), element('span', 'structure-feature-name', `${feature.name}: ${feature.type}`), element('span', 'structure-multiplicity', multiplicity(feature)));
        if (feature.derived) row.title = 'Derived feature; execution requires its semantic provider.';
        card.append(row);
      }
      cards.set(cls.name, card); cardLayer.append(card);
      (cls.operations || []).forEach((operation, index) => {
        const row = button('', () => choose({ class: cls.name, operation: index }), 'structure-feature');
        row.dataset.operation = String(index);
        row.setAttribute('aria-label', `${cls.name}.${operationSignature(operation)}`);
        row.title = 'Operation declaration; execution requires a supported semantic binding.';
        row.append(element('span', 'structure-feature-icon', 'ƒ'), element('span', 'structure-feature-name', operationSignature(operation)));
        card.append(row);
      });
    }
    if (!classifiers().length) cardLayer.append(element('p', 'structure-diagram-empty', 'Add a class to begin. Its diagram will appear here.'));
    fitCanvas(); renderEdges(); renderSelection(); revealSelection();
  }
  function renderEdges() {
    edges.replaceChildren();
    const definitions = svgElement('defs');
    const arrow = svgElement('marker', { id: 'structure-reference-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse' });
    arrow.append(svgElement('path', { d: 'M1 1 L9 5 L1 9', fill: 'none', stroke: 'var(--amber, #e9be76)', 'stroke-width': 1.4 }));
    const triangle = svgElement('marker', { id: 'structure-inheritance-arrow', viewBox: '0 0 12 12', refX: 11, refY: 6, markerWidth: 12, markerHeight: 12, orient: 'auto-start-reverse' });
    triangle.append(svgElement('path', { d: 'M1 1 L11 6 L1 11 Z', fill: 'var(--canvas, #10131d)', stroke: '#b5a5e5', 'stroke-width': 1.2 }));
    const diamond = svgElement('marker', { id: 'structure-containment-diamond', viewBox: '0 0 14 10', refX: 1, refY: 5, markerWidth: 14, markerHeight: 10, orient: 'auto' });
    diamond.append(svgElement('path', { d: 'M1 5 L7 1 L13 5 L7 9 Z', fill: 'var(--amber, #e9be76)', stroke: 'var(--amber, #e9be76)' }));
    definitions.append(arrow, triangle, diamond); edges.append(definitions);
    if (!description) return;
    const lookup = new Map(description.classes.map(cls => [cls.name, cls]));
    for (const cls of description.classes) {
      const relationships = [
        ...cls.super_types.map(type => ({ type, inheritance: true, name: 'extends' })),
        ...cls.features.filter(feature => feature.kind === 'reference'),
      ];
      relationships.forEach((relation, index) => {
        const target = lookup.get(relation.type);
        if (!target) return;
        const from = positions.get(cls.name); const to = positions.get(target.name);
        const offset = (index - (relationships.length - 1) / 2) * 14;
        let x1; let y1; let x2; let y2; let path; let labelX; let labelY;
        if (cls.name === target.name) {
          x1 = from.x + CARD_WIDTH; y1 = from.y + 30; x2 = x1; y2 = from.y + classHeight(cls) - 16;
          path = `M${x1} ${y1} C${x1 + 75} ${y1 - 25} ${x2 + 75} ${y2 + 25} ${x2} ${y2}`;
          labelX = x1 + 50; labelY = (y1 + y2) / 2;
        } else if (Math.abs(to.x - from.x) > Math.abs(to.y - from.y) * 0.8) {
          const right = to.x > from.x;
          x1 = from.x + (right ? CARD_WIDTH : 0); y1 = from.y + classHeight(cls) / 2 + offset;
          x2 = to.x + (right ? 0 : CARD_WIDTH); y2 = to.y + classHeight(target) / 2 + offset;
          const curve = Math.max(42, Math.abs(x2 - x1) / 2) * (right ? 1 : -1);
          path = `M${x1} ${y1} C${x1 + curve} ${y1} ${x2 - curve} ${y2} ${x2} ${y2}`;
          labelX = (x1 + x2) / 2; labelY = (y1 + y2) / 2 - 7;
        } else {
          const down = to.y > from.y;
          x1 = from.x + CARD_WIDTH / 2 + offset; y1 = from.y + (down ? classHeight(cls) : 0);
          x2 = to.x + CARD_WIDTH / 2 + offset; y2 = to.y + (down ? 0 : classHeight(target));
          const curve = Math.max(42, Math.abs(y2 - y1) / 2) * (down ? 1 : -1);
          path = `M${x1} ${y1} C${x1} ${y1 + curve} ${x2} ${y2 - curve} ${x2} ${y2}`;
          labelX = (x1 + x2) / 2 + 5; labelY = (y1 + y2) / 2 - 7;
        }
        const group = svgElement('g', { class: relation.inheritance ? 'structure-inheritance' : 'structure-reference' });
        const title = svgElement('title'); title.textContent = `${cls.name} ${relation.name} → ${target.name}${relation.inheritance ? '' : ` [${multiplicity(relation)}]${relation.containment ? ' (containment)' : ''}`}`;
        const line = svgElement('path', { d: path, fill: 'none', stroke: relation.inheritance ? '#b5a5e5' : 'var(--amber, #e9be76)', 'stroke-width': 1.5, 'marker-end': `url(#structure-${relation.inheritance ? 'inheritance' : 'reference'}-arrow)` });
        if (relation.containment) line.setAttribute('marker-start', 'url(#structure-containment-diamond)');
        const label = svgElement('text', { x: labelX, y: labelY, 'text-anchor': 'middle', class: 'structure-edge-label' });
        label.textContent = `${relation.name}${relation.inheritance ? '' : ` [${multiplicity(relation)}]`}`;
        group.append(title, line, label); edges.append(group);
      });
    }
  }
  function moveClass(name, x, y) {
    const position = positions.get(name);
    position.x = Math.max(16, Math.round(x)); position.y = Math.max(16, Math.round(y));
    const card = cards.get(name);
    card.style.left = `${position.x}px`; card.style.top = `${position.y}px`;
    fitCanvas(); renderEdges();
  }
  function beginMove(event, name, handle) {
    if (event.button !== 0) return;
    const position = positions.get(name);
    choose(classifierSelection(classifiers().find(cls => cls.name === name)), false);
    drag = { name, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: position.x, y: position.y };
    handle.setPointerCapture(event.pointerId);
    handle.onpointermove = move => {
      if (!drag || move.pointerId !== drag.pointer) return;
      moveClass(name, drag.x + (move.clientX - drag.startX) / zoom, drag.y + (move.clientY - drag.startY) / zoom);
    };
    handle.onpointerup = handle.onpointercancel = () => { drag = null; };
  }
  viewport.onpointerdown = event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    const start = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId); viewport.classList.add('is-panning');
    viewport.onpointermove = move => { viewport.scrollLeft = start.left - (move.clientX - start.x); viewport.scrollTop = start.top - (move.clientY - start.y); };
    viewport.onpointerup = viewport.onpointercancel = () => { viewport.onpointermove = null; viewport.classList.remove('is-panning'); };
  };

  function input(form, name, label, value, { type = 'text', options, help, readonly = false } = {}) {
    const wrapper = element('div', 'structure-field');
    const caption = element('label', '', label); caption.htmlFor = `${paneId}-${name}`; wrapper.append(caption);
    const control = element(options ? 'select' : 'input');
    control.name = name; control.id = caption.htmlFor;
    if (options) for (const option of [...new Set([String(value ?? ''), ...options])]) { const node = element('option', '', option || 'None'); node.value = option; control.append(node); }
    else control.type = type;
    if (type === 'checkbox') { wrapper.classList.add('structure-checkbox'); control.checked = Boolean(value); wrapper.prepend(control); }
    else { control.value = value ?? ''; wrapper.append(control); }
    if (type === 'number') { control.step = '1'; control.min = name === 'upper' ? '-1' : '0'; }
    if (readonly) { control.dataset.readonly = 'true'; control.disabled = true; }
    if (help) { const hint = element('small', '', help); hint.id = `${control.id}-help`; control.setAttribute('aria-describedby', hint.id); wrapper.append(hint); }
    form.append(wrapper);
    return control;
  }
  function renderProperties() {
    properties.replaceChildren();
    if (!description) { properties.append(element('p', 'structure-help', 'The shared Rust engine will read the structure definition.')); return; }
    const cls = selectedClass();
    const operation = cls?.operations?.[selection.operation];
    if (operation) {
      properties.append(element('h4', '', operation.name), element('p', 'structure-property-kind', `Operation · ${cls.name}`), element('p', 'structure-help', operationSignature(operation)), element('p', 'structure-help', 'Declaration metadata. Edit the signature in Rcore source. Execution requires a supported semantic binding.'));
      const { declaration, parameters, result, generic } = operation;
      const metadata = element('pre', 'structure-operation-metadata', JSON.stringify({ declaration, parameters, result, generic }, null, 2));
      properties.append(metadata);
      return;
    }
    const enumeration = selectedEnum();
    if (enumeration || selection.draft === 'enum') { renderEnumProperties(enumeration); return; }
    const feature = cls?.features.find(item => item.name === selection.feature);
    const draft = selection.draft;
    const title = draft ? `New ${draft}` : feature?.name || cls?.name || description.name;
    properties.append(element('h4', '', title));
    const kind = draft || feature?.kind || (cls ? 'class' : 'package');
    properties.append(element('p', 'structure-property-kind', draft ? `Add to ${cls?.name || description.name}` : `${kind === 'package' ? 'Metamodel' : kind === 'class' ? 'Class' : kind === 'reference' ? 'Reference' : 'Attribute'}${feature?.derived ? ' · derived' : ''}`));
    const form = element('form', 'structure-property-form');
    let buildEdit;
    if (draft) {
      const base = draft === 'class' ? 'NewClass' : draft === 'attribute' ? 'newAttribute' : 'newReference';
      const occupied = draft === 'class' ? classifiers().map(c => c.name) : cls.features.map(f => f.name);
      let suggested = base; let suffix = 2; while (occupied.includes(suggested)) suggested = `${base}${suffix++}`;
      const name = input(form, 'name', 'Name', suggested); name.required = true;
      let type;
      if (draft !== 'class') type = input(form, 'type', 'Type', draft === 'attribute' ? 'EString' : cls.name, { options: draft === 'attribute' ? attributeTypes() : description.classes.map(c => c.name) });
      buildEdit = () => ({ op: `add_${draft}`, ...(cls ? { class: cls.name } : {}), name: name.value.trim(), ...(type ? { type: type.value } : {}) });
    } else if (feature) {
      const name = input(form, 'name', 'Name', feature.name); name.required = true;
      const type = input(form, 'type', 'Type', feature.type, { options: feature.kind === 'attribute' ? attributeTypes() : description.classes.map(c => c.name) });
      const bounds = element('div', 'structure-bounds'); form.append(bounds);
      const lower = input(bounds, 'lower', 'Lower bound', feature.lower, { type: 'number' }); lower.required = true;
      const upper = input(bounds, 'upper', 'Upper bound', feature.upper, { type: 'number', help: '−1 means many' }); upper.required = true;
      const ordered = input(form, 'ordered', 'Ordered', feature.ordered, { type: 'checkbox' });
      const unique = input(form, 'unique', 'Unique', feature.unique, { type: 'checkbox' });
      let containment; let opposite; let defaultValue;
      if (feature.kind === 'reference') {
        containment = input(form, 'containment', 'Containment', feature.containment, { type: 'checkbox' });
        opposite = input(form, 'opposite', 'Opposite', feature.opposite || '', { help: 'Class/feature; leave empty for none' });
      } else defaultValue = input(form, 'default', 'Default value', feature.default || '', { help: 'Leave empty to remove an explicit default' });
      if (feature.derived) form.append(element('p', 'structure-help', 'Derived behavior is defined by the language’s semantic provider.'));
      buildEdit = () => ({ op: 'set_feature', class: cls.name, feature: feature.name, ...changedFields({ name: name.value.trim(), type: type.value, lower: Number(lower.value), upper: Number(upper.value), ordered: ordered.checked, unique: unique.checked, ...(containment ? { containment: containment.checked, opposite: opposite.value.trim() || null } : { default: defaultValue.value === (feature.default ?? '') ? feature.default ?? null : defaultValue.value || null }) }, feature) });
    } else if (cls) {
      const name = input(form, 'name', 'Name', cls.name); name.required = true;
      const abstract = input(form, 'abstract', 'Abstract class', cls.abstract, { type: 'checkbox' });
      const multiple = cls.super_types.length > 1;
      const superType = input(form, 'super_type', 'Extends', multiple ? cls.super_types.join(', ') : cls.super_types[0] || '', multiple ? { help: 'Comma-separated supertypes. Execution currently supports single inheritance.' } : { options: ['', ...description.classes.filter(c => c.name !== cls.name).map(c => c.name)] });
      buildEdit = () => ({ op: 'set_class', class: cls.name, ...changedFields({ name: name.value.trim(), abstract: abstract.checked, super_types: multiple ? superType.value.split(',').map(s => s.trim()).filter(Boolean) : superType.value ? [superType.value] : [] }, cls) });
    } else {
      const name = input(form, 'name', 'Name', description.name); name.required = true;
      const namespace = input(form, 'namespace', 'Namespace URI', description.namespace); namespace.required = true;
      const prefix = input(form, 'prefix', 'Namespace prefix', description.prefix);
      buildEdit = () => ({ op: 'set_package', ...changedFields({ name: name.value.trim(), namespace: namespace.value.trim(), prefix: prefix.value.trim() }, description) });
    }
    const actions = element('div', 'structure-property-actions');
    const apply = element('button', 'structure-apply', draft ? `Create ${draft}` : 'Apply changes'); apply.type = 'submit'; actions.append(apply);
    if (draft) actions.append(button('Cancel', () => choose(cls ? { class: cls.name } : {})));
    else if (cls) actions.append(button(feature ? 'Delete feature' : 'Delete class', () => applyEdit(feature ? { op: 'delete_feature', class: cls.name, feature: feature.name } : { op: 'delete_class', class: cls.name }), 'structure-delete'));
    form.append(actions);
    form.onsubmit = event => { event.preventDefault(); if (form.reportValidity()) applyEdit(buildEdit()); };
    properties.append(form);
  }
  function renderEnumProperties(enumeration) {
    const draft = selection.draft;
    const literal = enumeration?.literals.find(item => item.name === selection.literal);
    const isLiteral = Boolean(literal || draft === 'literal');
    const kind = isLiteral ? 'literal' : 'enum';
    let suggested = isLiteral ? 'NEW_LITERAL' : 'NewEnum';
    const occupied = isLiteral ? enumeration.literals.map(item => item.name) : classifiers().map(item => item.name);
    const base = suggested; let suffix = 2;
    while (occupied.includes(suggested)) suggested = `${base}${suffix++}`;
    properties.append(element('h4', '', draft ? `New ${kind}` : literal?.name || enumeration.name), element('p', 'structure-property-kind', isLiteral ? `Literal · ${enumeration.name}` : 'Enumeration'));
    const form = element('form', 'structure-property-form');
    const name = input(form, 'enum_name', 'Name', draft ? suggested : literal?.name || enumeration.name); name.required = true;
    let buildEdit;
    if (isLiteral) {
      const value = input(form, 'enum_value', 'Numeric value', literal?.value ?? 0, { type: 'number', help: 'Signed 32-bit integer. Multiple literals may share a numeric value.' });
      value.min = '-2147483648'; value.max = '2147483647'; value.required = true;
      const useName = input(form, 'enum_use_name', 'Use name as literal', literal?.literal == null, { type: 'checkbox' });
      const spelling = input(form, 'enum_literal', 'Literal spelling', literal?.literal ?? name.value, { help: 'Uncheck “Use name as literal” for a custom spelling; an empty spelling is allowed.' });
      const syncSpelling = () => {
        spelling.dataset.readonly = String(useName.checked);
        if (useName.checked) spelling.value = name.value;
        updateActions();
      };
      useName.onchange = syncSpelling;
      name.oninput = () => { if (useName.checked) spelling.value = name.value; };
      spelling.dataset.readonly = String(useName.checked);
      buildEdit = () => draft
        ? { op: 'add_literal', enumeration: enumeration.name, name: name.value.trim(), value: Number(value.value), literal: useName.checked ? null : spelling.value }
        : { op: 'set_literal', enumeration: enumeration.name, literal: literal.name, ...changedFields({ name: name.value.trim(), value: Number(value.value), spelling: useName.checked ? null : spelling.value }, { ...literal, spelling: literal.literal }) };
    } else {
      if (enumeration) input(form, 'enum_default', 'Implicit default', enumeration.literals[0]?.name || 'None (empty enum)', { readonly: true });
      form.append(element('p', 'structure-help', 'Add literals, then choose this enum in an attribute’s Type field. The first literal is the implicit default. Xtext enum rules require a compatible Native grammar profile; see the KerML enum rules test case.'));
      buildEdit = () => draft ? { op: 'add_enum', name: name.value.trim() } : { op: 'set_enum', enumeration: enumeration.name, name: name.value.trim() };
    }
    const actions = element('div', 'structure-property-actions');
    const apply = element('button', 'structure-apply', draft ? `Create ${kind}` : 'Apply changes'); apply.type = 'submit'; actions.append(apply);
    if (draft) actions.append(button('Cancel', () => choose(enumeration ? { enumeration: enumeration.name } : {})));
    else {
      if (!isLiteral) actions.append(button('Add literal', () => choose({ enumeration: enumeration.name, draft: 'literal' })));
      actions.append(button(`Delete ${kind}`, () => applyEdit({ op: `delete_${kind}`, enumeration: enumeration.name, ...(isLiteral ? { literal: literal.name } : {}) }), 'structure-delete'));
    }
    form.append(actions);
    form.onsubmit = event => { event.preventDefault(); if (form.reportValidity()) applyEdit(buildEdit()); };
    properties.append(form);
  }
  function selectionAfter(edit) {
    if (edit.op === 'add_enum' || edit.op === 'set_enum') return { enumeration: edit.name };
    if (edit.op === 'delete_enum') return {};
    if (edit.op === 'delete_literal') return { enumeration: edit.enumeration };
    if (edit.op === 'add_literal' || edit.op === 'set_literal') return { enumeration: edit.enumeration, literal: edit.name || edit.literal };
    if (edit.op === 'add_class' || edit.op === 'set_class') return { class: edit.name || edit.class };
    if (edit.op === 'delete_class' || edit.op === 'set_package') return {};
    if (edit.op === 'delete_feature') return { class: edit.class };
    return { class: edit.class, feature: edit.name || edit.feature };
  }
  async function applyEdit(edit) {
    if (!isCurrent() || editInFlight) return;
    const source = model.getValue(); const version = model.getVersionId();
    editInFlight = true; updateActions(); report('Applying definition edit…');
    try {
      const result = await request('intersect/definitionEdit', { source, edit });
      if (destroyed) return;
      if (model.getVersionId() !== version || model.getValue() !== source) {
        report('The source changed while the edit was running. The newer source was kept; apply the edit again.', true);
        return;
      }
      if (typeof result.source !== 'string') throw new Error('Definition editor did not return Ecore source.');
      if (edit.op === 'set_class' && edit.name && edit.name !== edit.class && positions.has(edit.class)) positions.set(edit.name, { ...positions.get(edit.class) });
      if (edit.op === 'set_enum' && edit.name !== edit.enumeration && positions.has(edit.enumeration)) positions.set(edit.name, { ...positions.get(edit.enumeration) });
      selection = selectionAfter(edit);
      if (onSource) onSource(result.source);
      else {
        model.pushStackElement();
        model.pushEditOperations([], [{ range: model.getFullModelRange(), text: result.source }], () => null);
        model.pushStackElement();
      }
      await refresh();
    } catch (error) {
      if (!destroyed) report(errorText(error), true);
    } finally { editInFlight = false; if (!destroyed) updateActions(); }
  }
  async function refresh() {
    clearTimeout(refreshTimer);
    const epoch = ++generation; const source = model.getValue(); const version = model.getVersionId();
    updateActions();
    try {
      const result = await request('intersect/definitionInspect', { source });
      if (destroyed || epoch !== generation || model.getVersionId() !== version || model.getValue() !== source) return;
      description = result; inspectedSource = source;
      if (selection.class && !selectedClass()) selection = {};
      if (selection.enumeration && !selectedEnum()) selection = {};
      if (selection.feature && !selectedClass()?.features.some(f => f.name === selection.feature)) selection = { class: selection.class };
      if (selection.operation !== undefined && !selectedClass()?.operations?.[selection.operation]) selection = { class: selection.class };
      if (selection.literal && !selectedEnum()?.literals.some(item => item.name === selection.literal)) selection = { enumeration: selection.enumeration };
      renderTree(); renderDiagram(); renderProperties(); renderSelection(); describeStatus(); updateActions();
    } catch (error) {
      if (destroyed || epoch !== generation || model.getVersionId() !== version) return;
      inspectedSource = null;
      report(`Cannot inspect this Ecore source. ${errorText(error)}${description ? ' The diagram shows the last readable definition.' : ''}`, true);
      updateActions();
    }
  }
  const subscription = model.onDidChangeContent(() => {
    generation++; updateActions();
    report('Source changed. Updating structure…');
    clearTimeout(refreshTimer); if (autoRefresh) refreshTimer = setTimeout(refresh, 180);
  });
  updateActions(); renderProperties();

  return {
    refresh,
    invalidate(message) { clearTimeout(refreshTimer); generation++; inspectedSource = null; report(message, true); updateActions(); },
    setView(view) {
      const source = view === 'source';
      toolbar.hidden = false; viewport.hidden = source; legend.hidden = false; diagramActions.hidden = false;
      diagramActions.style.visibility = source ? 'hidden' : 'visible'; diagramActions.inert = source;
      legend.style.visibility = source ? 'hidden' : 'visible';
      diagramHeading.querySelector('.structure-diagram-help').style.visibility = source ? 'hidden' : 'visible';
    },
    getLayout() { return { version: 1, positions: Object.fromEntries([...positions].map(([name, position]) => [name, { ...position }])), zoom }; },
    setLayout(layout) {
      if (!layout || layout.version !== 1 || !layout.positions || typeof layout.positions !== 'object' || Array.isArray(layout.positions)) throw new Error('Unsupported diagram layout.');
      const next = new Map();
      for (const [name, position] of Object.entries(layout.positions)) {
        if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y) || position.x < 0 || position.y < 0 || position.x > 100000 || position.y > 100000) throw new Error(`Invalid diagram position for ${name}.`);
        next.set(name, { x: position.x, y: position.y });
      }
      if (layout.zoom !== undefined && (!Number.isFinite(layout.zoom) || layout.zoom < 0.5 || layout.zoom > 1.5)) throw new Error('Invalid diagram zoom.');
      positions = next; zoom = layout.zoom ?? 1;
      if (isCurrent()) renderDiagram();
    },
    destroy() { destroyed = true; generation++; clearTimeout(refreshTimer); subscription.dispose(); splitters.destroy(); host.replaceChildren(); },
  };
}
