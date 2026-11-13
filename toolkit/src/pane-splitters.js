// View-only sizing: independent of definition source and saved diagram positions.
export function createPaneSplitters(host, panes, labels = ['Resize containment and class diagram', 'Resize class diagram and properties'], centerMinimum = 220) {
  const minimum = { tree: 140, diagram: centerMinimum, properties: panes.length === 3 ? 180 : 0 };
  const narrow = matchMedia('(max-width: 650px)');
  let proportions = null;
  let drag = null;
  const controls = [];
  const available = () => host.clientWidth - controls.reduce((sum, control) => sum + control.offsetWidth, 0);
  const sizes = () => ({ tree: panes[0].getBoundingClientRect().width, properties: panes[2]?.getBoundingClientRect().width || 0 });
  function bounds(side, current) {
    const other = side === 'tree' ? 'properties' : 'tree';
    return { min: minimum[side], max: Math.max(minimum[side], available() - minimum.diagram - current[other]) };
  }
  function updateAria() {
    const current = sizes();
    controls.forEach((control, index) => {
      const side = index === 0 ? 'tree' : 'properties';
      const limit = bounds(side, current);
      control.setAttribute('aria-valuemin', String(Math.round(limit.min)));
      control.setAttribute('aria-valuemax', String(Math.round(limit.max)));
      control.setAttribute('aria-valuenow', String(Math.round(current[side])));
      control.setAttribute('aria-valuetext', `${side === 'tree' ? 'Containment' : 'Properties'} width: ${Math.round(current[side])} pixels`);
    });
  }
  function apply(current) {
    host.style.setProperty('--containment-width', `${current.tree}px`);
    host.style.setProperty('--properties-width', `${current.properties}px`);
    updateAria();
  }
  function resize(side, width, current = sizes()) {
    const limit = bounds(side, current);
    current[side] = Math.max(limit.min, Math.min(limit.max, width));
    const total = available();
    proportions = { tree: current.tree / total, properties: current.properties / total };
    apply(current);
  }
  function stop() {
    const active = drag; drag = null;
    host.classList.remove('is-resizing');
    if (active?.control.hasPointerCapture(active.pointer)) active.control.releasePointerCapture(active.pointer);
  }
  function reset() {
    stop(); proportions = null;
    host.style.removeProperty('--containment-width'); host.style.removeProperty('--properties-width');
    updateAria();
  }
  for (let index = 0; index < panes.length - 1; index++) {
    const side = index === 0 ? 'tree' : 'properties';
    const control = document.createElement('div');
    control.className = 'structure-splitter'; control.tabIndex = 0;
    control.setAttribute('role', 'separator'); control.setAttribute('aria-orientation', 'vertical');
    control.setAttribute('aria-label', labels[index]);
    control.setAttribute('aria-controls', `${panes[index].id} ${panes[index + 1].id}`);
    control.title = 'Drag to resize · Left/Right arrows to adjust · Double-click or Enter to reset';
    panes[index].after(control); controls.push(control);
    control.onpointerdown = event => {
      if (event.button !== 0 || narrow.matches || drag) return;
      event.preventDefault(); control.focus();
      drag = { control, pointer: event.pointerId, start: event.clientX, initial: sizes(), side, width: available() };
      control.setPointerCapture(event.pointerId); host.classList.add('is-resizing');
    };
    control.onpointermove = event => {
      if (!drag || drag.control !== control || drag.pointer !== event.pointerId) return;
      const delta = (event.clientX - drag.start) * (side === 'tree' ? 1 : -1);
      resize(side, drag.initial[side] + delta, { ...drag.initial });
    };
    control.onpointerup = control.onpointercancel = control.onlostpointercapture = stop;
    control.ondblclick = reset;
    control.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Enter') { reset(); return; }
      const current = sizes(); const limit = bounds(side, current);
      const delta = (event.key === 'ArrowRight' ? 1 : -1) * (side === 'tree' ? 1 : -1) * (event.shiftKey ? 30 : 10);
      const width = event.key === 'Home' ? limit.min : event.key === 'End' ? limit.max : current[side] + delta;
      resize(side, width, current);
    };
  }
  function relayout() {
    if (!host.clientWidth || narrow.matches) return;
    if (drag && drag.width !== available()) stop();
    if (proportions) {
      const total = available();
      const current = {
        tree: Math.max(minimum.tree, Math.min(total - minimum.diagram - minimum.properties, total * proportions.tree)),
        properties: Math.max(minimum.properties, total * proportions.properties),
      };
      current.properties = Math.min(current.properties, total - minimum.diagram - current.tree);
      apply(current);
    } else updateAria();
  }
  const observer = new ResizeObserver(relayout); observer.observe(host);
  const onBreakpoint = () => { stop(); relayout(); };
  narrow.addEventListener('change', onBreakpoint);
  return { destroy() { stop(); observer.disconnect(); narrow.removeEventListener('change', onBreakpoint); controls.forEach(control => control.remove()); } };
}
