// Host-only session history. Change records and validation come from Rust.
export function createTransactionPanel() {
  const panel = document.createElement('section');
  panel.className = 'panel transactions'; panel.dataset.usage = ''; panel.hidden = true;
  panel.innerHTML = `<div class="panel-heading"><div><h2>Transactions</h2><span id="transaction-count" class="count">0 runs</span></div><button id="transactions-clear" class="text-button">Clear finished history</button></div><div class="transaction-layout"><div id="transaction-list" aria-label="Transaction history"></div><div id="transaction-detail" aria-live="polite"><p class="empty">Run a Python script to inspect its transaction.</p></div></div>`;
  document.querySelector('.python-results').after(panel);
  const list = panel.querySelector('#transaction-list'), detail = panel.querySelector('#transaction-detail');
  const entries = []; let selected = null, counter = 0, active = null;
  const node = (tag, text, className) => { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; };
  function render() {
    panel.querySelector('#transaction-count').textContent = `${entries.length} runs · latest 20`;
    list.replaceChildren();
    for (const entry of entries) {
      const button = node('button', `${entry.label} · ${entry.report.status.replaceAll('_', ' ')}\n${entry.report.changes.length} stored · ${entry.report.derived_changes.length} derived`, 'transaction-item');
      button.dataset.transactionId = entry.report.context.id;
      button.setAttribute('aria-pressed', String(selected === entry));
      button.onclick = () => { selected = entry; render(); }; list.append(button);
    }
    detail.replaceChildren();
    if (!selected) { detail.append(node('p', 'Run a Python script to inspect its transaction.', 'empty')); return; }
    const report = selected.report, committed = report.status === 'committed';
    detail.append(node('h3', `${selected.label} · ${report.status.replaceAll('_', ' ')}`));
    detail.append(node('p', `Transaction ${report.context.id}\nLanguage ${report.context.language_revision}\nStarting model generation ${report.context.base_generation}`, 'transaction-context'));
    detail.append(node('p', committed ? 'Committed changes' : 'Attempted changes — not published', 'transaction-outcome'));
    if (!report.changes_complete) detail.append(node('p', 'Incomplete report: last received progress only. Cancellation or a runtime failure can stop the worker before its final report.', 'transaction-warning'));
    if (report.reason) detail.append(node('pre', report.reason, 'transaction-error'));
    detail.append(node('p', `Validation: ${report.validation}`));
    for (const d of report.diagnostics) detail.append(node('p', d.message, 'transaction-error'));
    const changes = [...report.changes, ...report.derived_changes];
    if (!changes.length) detail.append(node('p', 'No reported model changes.'));
    for (const change of changes) {
      const row = node('details', '', 'transaction-change');
      row.append(node('summary', `${change.kind} · ${change.class}${change.feature ? '.' + change.feature : ''} · ${change.element}`));
      const values = node('div', '', 'transaction-values');
      values.append(node('pre', `Before\n${JSON.stringify(change.before, null, 2)}`), node('pre', `After\n${JSON.stringify(change.after, null, 2)}`)); row.append(values); detail.append(row);
    }
    const script = node('details', '', 'transaction-script'); script.append(node('summary', 'Script for this run'), node('pre', selected.script)); detail.append(script);
  }
  panel.querySelector('#transactions-clear').onclick = () => {
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i] !== active) entries.splice(i, 1);
    selected = entries[0] || null; render();
  };
  return {
    clear() { entries.length = 0; selected = null; active = null; counter = 0; render(); },
    begin(snapshot, script) {
      const entry = { label: `Run ${++counter}`, script, report: snapshot.transaction };
      entries.unshift(entry); if (entries.length > 20) entries.pop(); selected = entry; active = entry; render(); return entry;
    },
    update(entry, report, finished = false) {
      if (report.context.id !== entry.report.context.id) throw new Error('Transaction report identity mismatch');
      entry.report = report; if (finished && active === entry) active = null; render();
    },
    get entries() { return entries; },
  };
}
