// Handwritten binding generator. Output is marked generated; no model semantics here.
const reserved = new Set(('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case type self cls str int bool tuple list dict object property classmethod globals locals isinstance all find handle Self Final Mapping TypeVar overload TransactionInfo model REVISION validate inspect_model _Element _Self _MISSING _encode _wrap _call _host _json').split(' '));
function identifier(name) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || reserved.has(name)) throw new Error(`Python binding does not support identifier ${name}`);
  return name;
}
export const PYTHON_BINDING_VERSION = 7;
export function generatePythonApi(pkg, revision) {
  const classes = pkg.schema.classes;
  const declaredNames = Object.fromEntries(Object.keys(classes).map(key => [key, identifier(pkg.schema.declarations?.[key]?.name || key)]));
  const counts = new Map();
  for (const name of Object.values(declaredNames)) counts.set(name, (counts.get(name) || 0) + 1);
  const classNames = {}, usedNames = new Set();
  for (const key of Object.keys(classes)) {
    const declared = declaredNames[key];
    const name = identifier(counts.get(declared) === 1 ? declared : `${declared}_${key.replace(/[^A-Za-z0-9_]/g, '_')}`);
    if (usedNames.has(name)) throw new Error(`Python class binding name collision: ${name}`);
    usedNames.add(name); classNames[key] = name;
  }
  const parents = name => classes[name].parents;
  // Python's nominal class layout needs C3. This is an adapter restriction,
  // never a rule imposed on the native Ecore graph or model execution.
  const ordered = [], linearizations = new Map(), active = new Set();
  const visit = name => {
    if (linearizations.has(name)) return;
    if (!classes[name] || active.has(name)) throw new Error(`Invalid Python binding inheritance at ${name}`);
    active.add(name);
    const bases = parents(name); bases.forEach(visit);
    const queues = [...bases.map(base => [...linearizations.get(base)]), [...bases]];
    const linearization = [name];
    while (queues.some(q => q.length)) {
      const head = queues.filter(q => q.length).map(q => q[0]).find(candidate => queues.every(q => !q.slice(1).includes(candidate)));
      if (!head) throw new Error(`Python binding cannot represent Ecore inheritance for ${name}: inconsistent C3 order`);
      linearization.push(head);
      queues.forEach(q => { if (q[0] === head) q.shift(); });
    }
    linearizations.set(name, linearization); active.delete(name); ordered.push(name);
  };
  Object.keys(classes).forEach(visit);
  // Compilation has already rejected distinct declarations with the same name.
  const fields = name => Object.assign({}, ...[...linearizations.get(name)].reverse().map(base => classes[base].features));
  const derivation = (key, f) => pkg.semantics.derived.find(d => d.feature === f.name && linearizations.get(key).includes(d.class));
  // Permission transport only: the shared Rust host checks the selected source
  // contract again for every edit. Legacy stored derivations keep their API.
  const setting = (key, f) => pkg.grammar?.computed_settings?.find(c => c.class === key && c.feature === f.name);
  const storedWritable = (key, f) => f.changeable !== false && derivation(key, f)?.expression?.op === 'stored' && derivation(key, f).expression.writable === true;
  const permitted = (key, f, operation) => !setting(key, f) || setting(key, f).operations.includes(operation);
  const writable = (key, f) => !f.derived || (storedWritable(key, f) && permitted(key, f, 'set'));
  const type = (f, key) => { let t = f.reference ? classNames[f.target] : f.datatype ? 'dict[str, object]' : { EString: 'str', EDate: 'dict[str, object]', EByteArray: 'dict[str, object]', EChar: 'dict[str, object]', ECharacterObject: 'dict[str, object]', EBigInteger: 'dict[str, object]', EBigDecimal: 'dict[str, object]', EByte: 'int', EShort: 'int', EInt: 'int', ELong: 'dict[str, object]', EFloat: 'dict[str, object]', EDouble: 'dict[str, object]', EBoolean: 'bool', EByteObject: 'int', EShortObject: 'int', EIntegerObject: 'int', ELongObject: 'dict[str, object]', EFloatObject: 'dict[str, object]', EDoubleObject: 'dict[str, object]', EBooleanObject: 'bool' }[f.target]; if (f.upper !== 1) t = `tuple[${t}, ...]`; else if (!f.lower && (!f.derived || (key && derivation(key, f)?.expression?.op === 'stored'))) t += ' | None'; return t; };
  const operations = (f, key) => {
    const result = [{ name: `is_set_${f.name}`, args: '', returns: 'bool', call: `self._feature_call('is_set', '${f.name}')` }];
    if (f.derived) {
      if (storedWritable(key, f) && permitted(key, f, 'unset')) result.push({ name: `unset_${f.name}`, args: '', returns: 'None', call: `self._feature_call('unset', '${f.name}')` });
      if (f.upper !== 1 && storedWritable(key, f) && setting(key, f)?.operations.includes('append')) {
        const atom=type({...f,upper:1,lower:1});
        result.push({name:`add_${f.name}`,args:`value: ${atom}`,returns:'bool',call:`self._feature_call('collection', '${f.name}', operation='add', value=_encode(value))`});
      }
      return result;
    }
    result.push({ name: `unset_${f.name}`, args: '', returns: 'None', call: `self._feature_call('unset', '${f.name}')` });
    if (f.upper === 1) {
      if (!f.lower) result.push({ name: `clear_${f.name}`, args: '', returns: 'None', call: `self._set('${f.name}', None)` });
      return result;
    }
    const atom = type({ ...f, upper: 1, lower: 1 });
    const collection = (name, args, extra = '') => result.push({ name: `${name}_${f.name}`, args, returns: 'bool', call: `self._feature_call('collection', '${f.name}', operation='${name}'${extra})` });
    collection('add', `value: ${atom}`, ', value=_encode(value)');
    collection('remove', `value: ${atom}`, ', value=_encode(value)');
    collection('clear', '');
    if (f.ordered !== false) {
      collection('insert', `index: int, value: ${atom}`, ', index=index, value=_encode(value)');
      collection('replace', `index: int, value: ${atom}`, ', index=index, value=_encode(value)');
      collection('remove_at', 'index: int', ', index=index');
      collection('move', 'from_index: int, to_index: int', ", **{'from': from_index, 'to': to_index}");
    }
    return result;
  };
  const header = `# GENERATED by Intersect. Read-only API for language revision ${revision}.\n# Source identity: ${JSON.stringify(pkg.schema.uri)}\n`;
  let stub = header + 'from typing import Self, Final, Mapping, TypeVar, overload\n_T = TypeVar("_T")\nREVISION: Final[str]\ndef validate() -> list[dict[str, object]]: ...\ndef inspect_model() -> dict[str, object]: ...\n';
  let source = header + `from __future__ import annotations
import json as _json
import _intersect_host as _host
from types import MappingProxyType as _MappingProxyType
REVISION = ${JSON.stringify(revision)}
_MISSING = object()
def _call(method, **args):
    result = _json.loads(_host.request(_json.dumps(dict(method='script/' + method, revision=REVISION, **args))))
    if 'error' in result:
        raise RuntimeError(result['error'])
    return result['value']
def _encode(value):
    if isinstance(value, _Element):
        if value._revision != REVISION:
            raise RuntimeError('Stale Python handle')
        return value._id
    if isinstance(value, (list, tuple)):
        return [_encode(v) for v in value]
    return value
def _wrap(value):
    if value is None:
        return None
    if isinstance(value, list):
        return tuple(_wrap(v) for v in value)
    obj = object.__new__(_classes[value['class']])
    obj._id, obj._revision = value['id'], REVISION
    return obj
def _freeze(value):
    if isinstance(value, dict):
        return _MappingProxyType({k: _freeze(v) for k, v in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(v) for v in value)
    return value
class TransactionInfo:
    __slots__ = ('_report',)
    def __init__(self, report):
        object.__setattr__(self, '_report', _freeze(report))
    def __setattr__(self, name, value):
        raise AttributeError('Transaction information is read-only')
    @property
    def id(self):
        return self._report['context']['id']
    @property
    def status(self):
        return self._report['status']
    @property
    def language_revision(self):
        return self._report['context']['language_revision']
    @property
    def base_generation(self):
        return self._report['context']['base_generation']
    @property
    def changes(self):
        return self._report['changes']
    @property
    def derived_changes(self):
        return self._report['derived_changes']
    @property
    def validation(self):
        return self._report['validation']
    @property
    def diagnostics(self):
        return self._report['diagnostics']
class _ModelAPI:
    __slots__ = ()
    @property
    def transaction(self):
        return TransactionInfo(_call('transaction'))
    def create(self, cls, **values):
        if not isinstance(cls, type) or not issubclass(cls, _Element):
            raise TypeError('Expected a generated model class')
        return cls(**values)
    def find(self, cls, *, name):
        return _wrap(_call('find', **{'class': cls._class_key, 'name': name}))
    def all(self, cls):
        return _wrap(_call('all', **{'class': cls._class_key}))
    def delete(self, obj, *, subtree=False, incoming="reject"):
        if not isinstance(obj, _Element):
            raise TypeError('Expected a generated model object')
        if not isinstance(subtree, bool):
            raise TypeError('subtree must be a bool')
        return tuple(_call('delete', ids=[_encode(obj)], selection='subtrees' if subtree else 'objects', incoming=incoming))
    def reparent(self, obj, owner=None, feature=None, *, position=None):
        if not isinstance(obj, _Element) or (owner is not None and not isinstance(owner, _Element)):
            raise TypeError('Expected generated model objects')
        return _call('reparent', id=_encode(obj), owner=_encode(owner), feature=feature, position=position)
    def validate(self):
        return _call('validate')
    def inspect(self):
        return _call('inspect')
model = _ModelAPI()
class _Element:
    __slots__ = ('_id', '_revision')
    @property
    def handle(self):
        return self._id
    @classmethod
    def all(cls):
        return _wrap(_call('all', **{'class': cls._class_key}))
    @classmethod
    def find(cls, name):
        return _wrap(_call('find', **{'class': cls._class_key, 'name': name}))
    def _feature_call(self, method, feature, **args):
        if self._revision != REVISION:
            raise RuntimeError('Stale Python handle')
        return _call(method, id=self._id, feature=feature, **args)
    def _get(self, feature):
        if self._revision != REVISION:
            raise RuntimeError('Stale Python handle')
        return _call('get', id=self._id, feature=feature)
    def _set(self, feature, value):
        if self._revision != REVISION:
            raise RuntimeError('Stale Python handle')
        return _call('set', id=self._id, feature=feature, value=_encode(value))
def validate():
    return _call('validate')
def inspect_model():
    return _call('inspect')
`;
  stub += `class TransactionInfo:
    @property
    def id(self) -> str: ...
    @property
    def status(self) -> str: ...
    @property
    def language_revision(self) -> str: ...
    @property
    def base_generation(self) -> int: ...
    @property
    def changes(self) -> tuple[Mapping[str, object], ...]: ...
    @property
    def derived_changes(self) -> tuple[Mapping[str, object], ...]: ...
    @property
    def validation(self) -> str: ...
    @property
    def diagnostics(self) -> tuple[Mapping[str, object], ...]: ...
`;
  const factories = [];
  for (const key of ordered) {
    const name = classNames[key];
    const features = Object.values(fields(key)); features.forEach(f => identifier(f.name));
    const methodNames = new Set(features.map(f => f.name));
    for (const f of features) for (const op of operations(f, key)) {
      if (methodNames.has(op.name)) throw new Error(`Python feature method collision in ${name}: ${op.name}`);
      methodNames.add(op.name);
    }
    const stored = features.filter(f => !f.derived).sort((a, b) => (b.lower > 0) - (a.lower > 0) || a.name.localeCompare(b.name));
    const args = stored.map(f => `${f.name}: ${type(f, key)}${f.lower ? '' : ' = _MISSING'}`).join(', ');
    const stubArgs = stored.map(f => `${f.name}: ${type(f, key)}${f.lower ? '' : ' = ...'}`).join(', ');
    factories.unshift(`${ordered.length > 1 ? '    @overload\n' : ''}    def create(self, cls: type[${name}]${stubArgs ? ', *, ' + stubArgs : ''}) -> ${name}: ...\n`);
    const base = parents(key).map(parent => classNames[parent]).join(', ') || '_Element';
    source += `\nclass ${name}(${base}):\n    __slots__ = ()\n    _class_key = ${JSON.stringify(key)}\n    def __init__(self${args ? ', *, ' + args : ''}):\n        _values = {k: _encode(v) for k, v in locals().items() if k != 'self' and v is not _MISSING}\n        handle = _call('create', **{'class': ${JSON.stringify(key)}, 'values': _values})\n        self._id, self._revision = handle['id'], REVISION\n`;
    stub += `\nclass ${name}${parents(key).length ? '(' + parents(key).map(parent => classNames[parent]).join(', ') + ')' : ''}:\n    def __init__(self${stubArgs ? ', *, ' + stubArgs : ''}) -> None: ...\n    @property\n    def handle(self) -> str: ...\n    @classmethod\n    def all(cls) -> tuple[Self, ...]: ...\n    @classmethod\n    def find(cls, name: str) -> Self: ...\n`;
    for (const f of features) {
      for (const op of operations(f, key)) {
        const args = op.args ? `, ${op.args}` : '';
        source += `    def ${op.name}(self${args}) -> ${op.returns}:\n        return ${op.call}\n`;
        stub += `    def ${op.name}(self${args}) -> ${op.returns}: ...\n`;
      }
      const contract = derivation(key, f);
      const doc = f.derived ? `${writable(key, f) ? "Writable setting" : "Read-only"}; Rust rcore_behavior ${JSON.stringify(contract?.expression || {})}` : `Stored Ecore feature ${name}.${f.name}`;
      source += `    @property\n    def ${f.name}(self) -> ${type(f, key)}:\n        ${JSON.stringify(doc)}\n        return ${f.reference ? '_wrap(' : f.upper !== 1 ? 'tuple(' : ''}self._get('${f.name}')${f.reference || f.upper !== 1 ? ')' : ''}\n`;
      stub += `    @property\n    def ${f.name}(self) -> ${type(f, key)}:\n        ${JSON.stringify(doc)}\n        ...\n`;
      if (writable(key, f)) {
        source += `    @${f.name}.setter\n    def ${f.name}(self, value: ${type(f, key)}):\n        self._set('${f.name}', value)\n`;
        stub += `    @${f.name}.setter\n    def ${f.name}(self, value: ${type(f, key)}) -> None: ...\n`;
      }
    }
  }
  stub += `
class _ModelAPI:
    @property
    def transaction(self) -> TransactionInfo: ...
${factories.join('')}    def find(self, cls: type[_T], *, name: str) -> _T: ...
    def all(self, cls: type[_T]) -> tuple[_T, ...]: ...
    def delete(self, obj: ${ordered.map(key => classNames[key]).join(' | ') || 'object'}, *, subtree: bool = False, incoming: str = "reject") -> tuple[str, ...]: ...
    def reparent(self, obj: ${ordered.map(key => classNames[key]).join(' | ') || 'object'}, owner: ${ordered.map(key => classNames[key]).join(' | ') || 'object'} | None = None, feature: str | None = None, *, position: int | None = None) -> bool: ...
    def validate(self) -> list[dict[str, object]]: ...
    def inspect(self) -> dict[str, object]: ...
model: Final[_ModelAPI]
`;
  source += `\n_classes = {${ordered.map(key => `${JSON.stringify(key)}: ${classNames[key]}`).join(', ')}}\n`;
  return { source, stub, revision, classNames };
}

export const exampleScript = `from intersect_api import Library, BookCopy, Member, Loan, model

print("Transaction:", model.transaction.id, model.transaction.status)
library = model.find(Library, name="Circulation")
copy = model.find(BookCopy, name="earthsea")
member = model.find(Member, name="ada")
print("Available before:", copy.available)
print("Enum default:", copy.condition)
condition = copy.condition
assert condition["kind"] == "enum", "Expected an enum identity"
copy.condition = condition
assert copy.condition == condition, "Enum identity must survive set/unset"
copy.unset_condition()
assert not copy.is_set_condition(), "Unset must clear the explicit setting"
assert copy.condition == condition, "Enum identity must survive set/unset"
assert copy.library.name == "Catalog", "Containment opposite must resolve"
assert copy.edition == 2, "Authored edition must be preserved"
print("Enum default after unset:", copy.condition)
loan = model.create(Loan, name="second", copy=copy, member=member)
library.loans = (*library.loans, loan)
print("Available after:", copy.available)
print("Copies in catalog:", Library.find("Catalog").copyCount)
print("Validation:", model.validate())
`;
