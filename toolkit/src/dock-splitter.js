// Resize the bottom tools without changing documents or model state.
export function createDockSplitter(host, dock, open) {
  const handle = document.createElement('div');
  handle.className = 'dock-splitter'; handle.tabIndex = 0;
  handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'horizontal');
  handle.setAttribute('aria-label', 'Resize bottom panel'); handle.setAttribute('aria-controls', 'dock-content');
  handle.title = 'Drag up/down to resize · Up/Down arrows to adjust · Double-click or Enter to reset';
  dock.before(handle);
  let drag = null, height = null;
  const maximum = () => Math.max(100, host.clientHeight - 180);
  function aria() {
    const actual = Math.round(dock.getBoundingClientRect().height);
    handle.setAttribute('aria-valuemin', '31'); handle.setAttribute('aria-valuemax', String(maximum()));
    handle.setAttribute('aria-valuenow', String(actual)); handle.setAttribute('aria-valuetext', `Bottom panel height: ${actual} pixels`);
  }
  function resize(value) {
    height = Math.max(100, Math.min(maximum(), value));
    dock.style.setProperty('--dock-height', `${height}px`); open(); aria();
  }
  function stop() {
    const active = drag; drag = null; host.classList.remove('is-resizing-dock');
    if (active && handle.hasPointerCapture(active.pointer)) handle.releasePointerCapture(active.pointer);
  }
  function reset() { stop(); height = null; dock.style.removeProperty('--dock-height'); aria(); }
  handle.onpointerdown = event => {
    if (event.button !== 0 || drag) return;
    event.preventDefault(); handle.focus();
    drag = { pointer: event.pointerId, y: event.clientY, height: dock.getBoundingClientRect().height };
    handle.setPointerCapture(event.pointerId); host.classList.add('is-resizing-dock');
  };
  handle.onpointermove = event => {
    if (drag?.pointer === event.pointerId) resize(drag.height + drag.y - event.clientY);
  };
  handle.onpointerup = handle.onpointercancel = handle.onlostpointercapture = stop;
  handle.ondblclick = reset;
  handle.onkeydown = event => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Enter') { reset(); return; }
    const step = (event.shiftKey ? 30 : 10) * (event.key === 'ArrowUp' ? 1 : -1);
    resize(event.key === 'Home' ? 100 : event.key === 'End' ? maximum() : dock.getBoundingClientRect().height + step);
  };
  const observer = new ResizeObserver(() => {
    if (height !== null && height > maximum()) { height = maximum(); dock.style.setProperty('--dock-height', `${height}px`); }
    aria();
  });
  observer.observe(host); observer.observe(dock);
  return { destroy() { stop(); observer.disconnect(); handle.remove(); } };
}
