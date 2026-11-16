import { createPaneSplitters } from './pane-splitters.js';
import { createDockSplitter } from './dock-splitter.js';

// Arrange existing editors and commands without creating another model state.
export function createIdeShell() {
  const $ = selector => document.querySelector(selector);
  const app = $('#app');
  const header = $('.topbar');
  const main = $('main');
  let activity = 'definition';
  let rcoreEnabled=false;
  let selected = 'problems';
  const remembered = { definition: 'problems', usage: 'output' };
  const expanded = { definition: false, usage: false };

  const menu = document.createElement('details');
  menu.className = 'ide-file-menu';
  menu.innerHTML = '<summary>File</summary><div class="ide-file-commands"></div>';
  const commands = menu.lastElementChild;
  header.append(menu, $('.major-tabs'));
  const projectControls = $('#project-controls');
  commands.append(projectControls);
  function commandGroup(label) {
    const group = document.createElement('section'); group.className = 'ide-command-group';
    group.setAttribute('role', 'group'); group.setAttribute('aria-label', label);
    const heading = document.createElement('h3'); heading.textContent = label; group.append(heading);
    projectControls.append(group); return group;
  }
  const starterCommands = commandGroup('Starter projects');
  starterCommands.append($('#new-empty-project'), $('#new-sample-project'), $('#new-kerml-project'), $('#new-inferred-project'));
  const projectCommands = commandGroup('Project');
  projectCommands.append($('#open-project'), $('#save-project'));
  const metamodelCommands = commandGroup('Metamodel · Define');
  metamodelCommands.append($('#open-rcore'), $('#save-rcore'), $('#open-behavior-source'), $('#export-package'));
  const modelCommands = commandGroup('Model · Test');
  const interchangeStatus = $('#interchange-status');
  interchangeStatus.remove();
  modelCommands.append($('.model-format-actions'), $('#export'), $('#export-model'));
  $('.model-export-actions').remove();
  projectControls.append($('.ide-test-cases'));
  projectControls.querySelector('.toolkit-file-actions').remove();
  const mode = $('#definition-mode');
  mode.setAttribute('aria-label', 'Definition mode');
  mode.options[0].textContent = 'Rcore + Xtext';
  mode.options[1].textContent = 'Rcore structure';
  const modeHint = $('#definition-mode-hint');
  modeHint.remove();
  header.append(mode, $('#compile'));
  $('#compile').innerHTML = '<span aria-hidden="true">▷</span> Compile <kbd>Ctrl ↵</kbd>';
  $('.intro').remove();
  $('.toolkit-definition-options').remove();
  commands.addEventListener('click', event => {
    if (event.target.closest('button')) {
      menu.open = false;
      if (!$('#package-dialog')?.open) menu.firstElementChild.focus();
    }
  });
  $('#package-dialog').addEventListener('close', () => menu.firstElementChild.focus());
  document.addEventListener('pointerdown', event => {
    if (!menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) { menu.open = false; menu.firstElementChild.focus(); }
  });

  const tabs = document.createElement('div');
  tabs.className = 'ide-editor-tabs';
  const definitions = $('.definitions');
  tabs.append($('.definitions > .tabs'));
  tabs.setAttribute('role','tablist'); tabs.setAttribute('aria-label','Definition sidebar');
  const treePanel = $('.structure-tree-panel');
  treePanel.querySelector('h3').replaceWith(tabs);
  $('#ecore-views').append($('[data-definition="xtext"]'));
  document.querySelectorAll('.definition-guide-workspace').forEach(workspace => $('.structure-diagram-panel').append(workspace));
  $('.structure-diagram-heading h3').replaceWith($('#ecore-views'));
  $('.structure-diagram-heading').append($('#ecore-history'));
  const toolbar = $('.structure-toolbar');
  $('.structure-diagram-heading').after(toolbar);
  toolbar.append($('#ecore-folding'), $('#xtext-guide-toggle'), $('#rcore-guide-toggle'));
  toolbar.after($('#inference-source-controls'), $('#inference-provider-controls'), $('#inference-generated-controls'));
  $('.definitions > .panel-heading').remove();
  // Keep contextual information accessible in the status popover.
  const info = document.createElement('details');
  info.className = 'ide-info';
  info.innerHTML = '<summary aria-label="Runtime and preview information">ⓘ</summary><div class="ide-info-content"></div>';
  info.lastElementChild.append($('.runtime'), $('#compile-detail'), modeHint, $('#definition-file'), $('.page-footer'), $('#restart'));
  const status = $('.compile-strip');
  status.classList.add('ide-statusbar');
  status.append($('#definition-state'), interchangeStatus, $('#project-status'), info);
  app.append(status);
  $('.definitions > .file-path').remove();
  // Folding belongs to the center source editor; history stays in the top bar.

  $('.definitions > .panel-footer').hidden = true;

  const testWorkspace = document.createElement('section');
  testWorkspace.id = 'test-workspace'; testWorkspace.dataset.usage = ''; testWorkspace.hidden = true;
  const usage = $('#usage-page');
  usage.removeAttribute('data-usage'); usage.hidden = false;
  usage.before(testWorkspace);
  const containment = document.createElement('aside');
  containment.id = 'test-containment'; containment.className = 'panel';
  containment.setAttribute('aria-label', 'Model containment');
  containment.innerHTML = '<div class="panel-heading"><h2>Containment</h2></div>';
  containment.firstElementChild.append($('#element-count'));
  containment.append($('#model-tree'));
  const properties = $('.inspector');
  properties.id = 'test-properties'; properties.removeAttribute('data-usage'); properties.hidden = false;
  properties.querySelector('h2').textContent = 'Properties';
  testWorkspace.append(containment, usage, properties);
  createPaneSplitters(testWorkspace, [containment, usage, properties], ['Resize model containment and editors', 'Resize model editors and properties'], 260);

  const dock = document.createElement('section');
  dock.className = 'ide-dock';
  dock.setAttribute('aria-label', 'Workbench tools');
  dock.innerHTML = '<div class="ide-dock-bar"><nav role="tablist" aria-label="Workbench tools"></nav><button id="dock-toggle" class="text-button" aria-label="Show bottom panel" aria-expanded="false">⌃</button></div><div class="ide-dock-content" id="dock-content"></div>';
  main.append(dock);
  createDockSplitter(main, dock, () => { expanded[activity] = true; render(); });
  const auxiliary = document.createElement('div'); auxiliary.className = 'window-aux'; main.append(auxiliary);
  auxiliary.append($('#api-editor').closest('.panel'));
  const panels = {
    output: ['Output', $('#python-output').closest('.panel')],
    transactions: ['Transactions', $('.transactions')],
    problems: ['Problems', $('.diagnostics')],
    rcore: ['Rcore behavior', $('#rcore-behavior-panel')],
  };
  for (const [id, [label, panel]] of Object.entries(panels)) {
    panel.removeAttribute('data-usage');
    panel.id = `dock-${id}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `dock-tab-${id}`);
    const button = document.createElement('button');
    button.className = 'tab'; button.id = `dock-tab-${id}`;
    button.dataset.dock = id; button.textContent = label;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', panel.id);
    button.onclick = () => { selected = id; remembered[activity] = id; expanded[activity] = true; render(); };
    dock.querySelector('nav').append(button);
    dock.lastElementChild.append(panel);
  }
  $('#dock-tab-problems').append($('#diagnostic-count'));
  // These wrappers are now empty; all content lives in the dock.
  document.querySelectorAll('main > .results').forEach(node => node.remove());
  $('#dock-toggle').onclick = () => { expanded[activity] = !expanded[activity]; render(); };
  dock.querySelector('nav').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...dock.querySelectorAll('[data-dock]:not([hidden])')];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].click(); buttons[next].focus();
  });
  function render() {
    mode.hidden = activity !== 'definition';
    $('#compile').hidden = activity !== 'definition';
    metamodelCommands.hidden = activity !== 'definition';
    modelCommands.hidden = activity !== 'usage';
    menu.firstElementChild.title = activity === 'definition' ? 'Project and metamodel commands' : 'Project and model commands';
    const open = expanded[activity];
    dock.classList.toggle('is-open', open);
    $('#dock-content').hidden = !open;
    $('#dock-toggle').setAttribute('aria-expanded', String(open));
    $('#dock-toggle').setAttribute('aria-label', open ? 'Hide bottom panel' : 'Show bottom panel');
    $('#dock-toggle').textContent = open ? '⌄' : '⌃';
    for (const [id, [, panel]] of Object.entries(panels)) {
      const button = $(`#dock-tab-${id}`);
      button.hidden = (activity === 'definition' && id !== 'problems') || (id === 'rcore' && !rcoreEnabled);
      button.classList.toggle('selected', id === selected && open);
      button.setAttribute('aria-selected', String(id === selected));
      button.tabIndex = id === selected ? 0 : -1;
      panel.hidden = button.hidden || !open || id !== selected;
    }
  }
  // Put successful structure messages in the status bar; keep errors near edits.
  const message = $('.structure-message');
  const summary = document.createElement('span'); summary.className = 'ide-structure-status';
  status.insertBefore(summary, info);
  const observer = new MutationObserver(() => {
    summary.textContent = message.textContent;
    summary.title = message.textContent;
  });
  observer.observe(message, { childList: true, subtree: true, characterData: true });
  render();
  return {
    rcore(enabled) { rcoreEnabled=enabled; if (!enabled && remembered.usage==='rcore') remembered.usage='output'; render(); },
    python(pane) {
      for (const [id, panel] of [['output', pane.outputPanel]]) {
        if (panels[id][1] === panel) continue;
        const previous = panels[id][1]; previous.removeAttribute('id'); previous.hidden = true; auxiliary.append(previous);
        panel.id = 'dock-' + id; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', 'dock-tab-' + id);
        panel.removeAttribute('data-usage'); dock.lastElementChild.append(panel); panels[id][1] = panel;
      }
      render();
    },
    activity(name) { menu.open = false; activity = name; selected = remembered[name]; render(); },
    showModelDetails() {
      if (activity !== 'usage') return;
      if (matchMedia('(max-width: 650px)').matches) properties.scrollIntoView({ block: 'nearest' });
    },
  };
}
