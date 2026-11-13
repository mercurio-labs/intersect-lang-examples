import './definition-guide.css';

export function createDefinitionGuide(definitions, id, label, content) {
  const workspace = document.createElement('div');
  workspace.className = 'definition-guide-workspace'; workspace.hidden = true;
  const editorHost = document.createElement('div');
  editorHost.className = 'definition-guide-editor';
  const guide = document.createElement('aside');
  guide.id = `${id}-guide`; guide.className = 'definition-guide';
  guide.setAttribute('aria-label', `${label} language guide`);
  guide.innerHTML = `<header class="definition-guide-heading"><h2>${label} guide</h2><button type="button" class="text-button" aria-label="Collapse ${label} guide">›</button></header>
    <div class="definition-guide-content" tabindex="0" aria-label="${label} syntax reference">${content}</div>`;
  const toggle = document.createElement('button');
  toggle.id = `${id}-guide-toggle`; toggle.className = 'text-button definition-guide-toggle'; toggle.type = 'button';
  toggle.textContent = `${label} guide`; toggle.hidden = true;
  toggle.setAttribute('aria-controls', guide.id);
  let expanded = true;
  function render() {
    guide.hidden = !expanded;
    toggle.setAttribute('aria-expanded', String(expanded));
  }
  toggle.onclick = () => { expanded = !expanded; render(); };
  guide.querySelector('button').onclick = () => { expanded = false; render(); toggle.focus(); };
  workspace.append(editorHost, guide);
  definitions.append(toggle, workspace);
  render();
  return {
    editorHost,
    setActive(active) { workspace.hidden = !active; toggle.hidden = !active; },
  };
}
