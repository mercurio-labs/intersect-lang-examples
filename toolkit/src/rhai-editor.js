// Editor affordances over Rust-generated binding metadata. This is a bounded
// parameter-scope completion provider, not a Rhai type checker or evaluator.
function codeOnly(source) {
  // Preserve offsets while masking comments and strings, including Rhai's
  // interpolated strings. Property suggestions never originate in these spans.
  const code = source.split('');
  const mask = index => { if (source[index] !== '\n' && source[index] !== '\r') code[index] = ' '; };
  let quote = null, blockDepth = 0, lineComment = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i], next = source[i + 1];
    if (lineComment) {
      mask(i); if (char === '\n' || char === '\r') lineComment = false;
    } else if (blockDepth) {
      mask(i);
      if (char === '/' && next === '*') { blockDepth++; mask(++i); }
      else if (char === '*' && next === '/') { blockDepth--; mask(++i); }
    } else if (quote) {
      mask(i);
      if (char === '\\' && next !== undefined) mask(++i);
      else if (char === quote) quote = null;
    } else if (char === '/' && next === '/') {
      lineComment = true; mask(i); mask(++i);
    } else if (char === '/' && next === '*') {
      blockDepth = 1; mask(i); mask(++i);
    } else if (char === '"' || char === "'" || char === '`') {
      quote = char; mask(i);
    }
  }
  return code.join('');
}
function scriptName(contract) {
  return contract.descriptor.external ? contract.descriptor.name : `binding_${contract.descriptor.symbol.declaration}`;
}
function context(model, position, contracts) {
  const source = model.getValue(), offset = model.getOffsetAt(position), code = codeOnly(source);
  if (code[offset] !== source[offset] || (offset > 0 && code[offset - 1] !== source[offset - 1])) return null;
  const functions = /\bfn\s+([A-Za-z_]\w*)\s*\(([^()]*)\)\s*\{/g;
  for (const match of code.matchAll(functions)) {
    const start = match.index + match[0].length;
    if (offset < start) continue;
    let depth = 1, end = start;
    for (; end < code.length && depth; end++) {
      if (code[end] === '{') depth++;
      else if (code[end] === '}') depth--;
    }
    if (offset >= end && depth === 0) continue;
    const contract = contracts.find(c => scriptName(c) === match[1]);
    if (!contract) return null;
    const names = match[2].split(',').map(name => name.trim());
    if (names.length !== contract.descriptor.parameters.length) return null;
    return { contract, names, code, offset, body: code.slice(start, offset) };
  }
  return null;
}
function receiverProperties(scope, receiver) {
  const parameter = scope.names.indexOf(receiver);
  // A local rebinding removes the parameter's known type in this bounded
  // provider. Do not advertise its original model properties after shadowing.
  if (new RegExp(`\\blet\\s+${receiver}\\b|\\b${receiver}\\s*=(?!=)`).test(scope.body)) return null;
  return scope.contract.properties?.find(binding => binding.parameter === parameter);
}
function typeLabel(property) {
  return property.scalar ? `${property.scalar}${property.optional ? '?' : ''}` : 'unsupported';
}
function documentation(binding, property) {
  return { value: `**${binding.class_name}.${property.name}**: ${typeLabel(property)}\n\n` +
    (property.unsupported || 'Read-only property of the current checked model.') +
    (property.optional && !property.unsupported ? '\n\nAn absent value returns `()`. Stored defaults apply.' : '') };
}

export function registerRhaiEditor({ monaco, model }) {
  let contracts = [];
  const completion = monaco.languages.registerCompletionItemProvider('rhai', {
    triggerCharacters: ['.'],
    provideCompletionItems(target, position) {
      if (target !== model) return { suggestions: [] };
      const scope = context(target, position, contracts);
      if (!scope) return { suggestions: [] };
      const word = target.getWordUntilPosition(position);
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
        startColumn: word.startColumn, endColumn: word.endColumn };
      const prefix = scope.code.slice(0, scope.offset);
      const access = prefix.match(/\b([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)?$/);
      if (access) {
        const binding = receiverProperties(scope, access[1]);
        return { suggestions: (binding?.properties ?? []).map(property => ({
          label: property.name, insertText: property.name, range,
          kind: monaco.languages.CompletionItemKind.Property,
          detail: property.unsupported ? `${binding.class_name}: unsupported` :
            `${binding.class_name}.${property.name}: ${typeLabel(property)} (read-only)`,
          documentation: documentation(binding, property),
          sortText: `${property.unsupported ? '1' : '0'}${property.name}`,
          tags: property.unsupported ? [monaco.languages.CompletionItemTag.Deprecated] : [],
        })) };
      }
      // Do not offer globals or parameters for an unknown receiver.
      if (/\.\s*\w*$/.test(prefix)) return { suggestions: [] };
      return { suggestions: scope.names.map((name, parameter) => {
        const binding = scope.contract.properties?.find(b => b.parameter === parameter);
        return { label: name, insertText: name, range, kind: monaco.languages.CompletionItemKind.Variable,
          detail: binding?.class_name ?? 'Function parameter' };
      }) };
    },
  });
  const hover = monaco.languages.registerHoverProvider('rhai', {
    provideHover(target, position) {
      if (target !== model) return null;
      const scope = context(target, position, contracts), word = target.getWordAtPosition(position);
      if (!scope || !word) return null;
      const start = target.getOffsetAt({ lineNumber: position.lineNumber, column: word.startColumn });
      const receiver = scope.code.slice(0, start).match(/\b([A-Za-z_]\w*)\s*\.\s*$/)?.[1];
      if (!receiver) return null;
      const binding = receiverProperties(scope, receiver);
      const property = binding?.properties.find(p => p.name === word.word);
      return property ? { range: { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
        startColumn: word.startColumn, endColumn: word.endColumn },
        contents: [documentation(binding, property)] } : null;
    },
  });
  return { update(value) { contracts = value; }, clear() { contracts = []; },
    dispose() { completion.dispose(); hover.dispose(); } };
}
