"""Retain attribution and provenance for the focused static alpha artifact.

The Rust inventory conservatively covers the host's resolved normal/build graph,
not a claim that every crate survives linking. Fixture notices cover the reviewed
runtime input families; dev-only dependencies and unrelated browser assets are
not represented as shipped code. No network downloads occur here.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.runtime/intersect-text'
OUT = ROOT / 'alpha-dist'


def run(*args, cwd=RUNTIME):
    return subprocess.check_output(args, cwd=cwd, encoding='utf-8').strip()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def retain(source, relative):
    target = OUT / 'licenses' / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    return {'path': target.relative_to(OUT).as_posix(), 'sha256': digest(target)}


def main():
    pin = json.loads((ROOT / 'runtime.json').read_text(encoding='utf-8'))
    if run('git', 'rev-parse', 'HEAD') != pin['revision']:
        raise ValueError('Runtime source does not match runtime.json')
    if run('git', 'status', '--porcelain', '--untracked-files=no'):
        raise ValueError('Runtime source has tracked modifications')
    metadata = json.loads(run('cargo', 'metadata', '--format-version', '1', '--locked',
                              '--offline', '--filter-platform', 'wasm32-unknown-unknown'))
    packages = {p['id']: p for p in metadata['packages']}
    nodes = {n['id']: n for n in metadata['resolve']['nodes']}
    host = next(p for p in packages.values() if p['name'] == 'intersect-web')
    pending, reached = [host['id']], set()
    while pending:
        current = pending.pop()
        if current in reached:
            continue
        reached.add(current)
        pending += [d['pkg'] for d in nodes[current]['deps']
                    if any(k['kind'] != 'dev' for k in d['dep_kinds'])]
    models = [packages[ident] for ident in reached if packages[ident]['name'] == 'intersect-model']
    texts = [packages[ident] for ident in reached if packages[ident]['name'] == 'intersect-text']
    if len(models) != 1 or len(texts) != 1:
        raise ValueError('Web host must resolve exactly one Model and one Text package')
    model, = models
    text, = texts
    if not (model.get('source') or '').startswith('git+'):
        raise ValueError('Web host must use the pinned Model source')
    if Path(text['manifest_path']).resolve() != (RUNTIME / 'crates/intersect-text/Cargo.toml').resolve():
        raise ValueError('Web host must use Text from the pinned runtime checkout')
    model_root = Path(model['manifest_path']).parents[2]
    model_revision = model['source'].rsplit('#', 1)[1]
    if run('git', 'rev-parse', 'HEAD', cwd=model_root) != model_revision:
        raise ValueError('Model source revision mismatch')
    if run('git', 'status', '--porcelain', '--untracked-files=no', cwd=model_root):
        raise ValueError('Model source has tracked modifications')

    spec = importlib.util.spec_from_file_location('release_notices', RUNTIME / 'tools/release_notices.py')
    notices_tool = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(notices_tool)
    components = []
    for label, source in [('examples', ROOT.parent), ('text', RUNTIME), ('model', model_root)]:
        components.append({'component': f'Intersect {label}', 'license': 'MIT',
                           'notices': [retain(source / 'LICENSE', Path(label) / 'LICENSE')]})
    for label, source in [('text', RUNTIME), ('model', model_root)]:
        for ident, name, license_name, _, files in notices_tool.RULES:
            if not all((source / f).is_file() for f in files):
                continue
            components.append({'component': f'{name} ({label} runtime input family)', 'license': license_name,
                               'notices': [retain(source / f, Path(label) / f) for f in files]})

    registry = []
    for ident in sorted(reached):
        package = packages[ident]
        if not (package['source'] or '').startswith('registry+'):
            continue
        directory = Path(package['manifest_path']).parent
        key = f"{package['name']}-{package['version']}"
        files = [p for p in sorted(directory.rglob('*')) if p.is_file()
                 and re.search(r'licen[cs]e|notice|copying|copyright', p.name, re.I)]
        if package.get('license_file'):
            explicit = (directory / package['license_file']).resolve()
            if not explicit.is_relative_to(directory.resolve()):
                raise ValueError(f'Escaping license path: {key}')
            if explicit not in files:
                files.append(explicit)
        retained = [retain(p, Path('rust') / key / p.relative_to(directory)) for p in files]
        supplement = RUNTIME / 'tools/release-notices' / key
        if supplement.is_dir():
            provenance = json.loads((supplement / 'provenance.json').read_text(encoding='utf-8'))
            vcs = json.loads((directory / '.cargo_vcs_info.json').read_text(encoding='utf-8'))
            if (provenance['package'], provenance['version'], provenance['revision'], provenance['license']) != (
                    package['name'], package['version'], vcs['git']['sha1'], package['license']):
                raise ValueError(f'Notice provenance mismatch: {key}')
            for entry in provenance['files']:
                p = supplement / entry['file']
                if p.parent != supplement or digest(p) != entry['sha256']:
                    raise ValueError(f'Notice hash/path mismatch: {key}')
                retained.append(retain(p, Path('rust') / key / p.name))
            retained.append(retain(supplement / 'provenance.json', Path('rust') / key / 'provenance.json'))
        if not retained:
            raise ValueError(f'Missing registry notices: {key}')
        registry.append({'component': key, 'license': package['license'], 'notices': retained})

    vite = ROOT / 'node_modules/vite'
    vite_version = json.loads((vite / 'package.json').read_text(encoding='utf-8'))['version']
    components.append({'component': f'Vite {vite_version} modulepreload helper (license also lists build-tool dependencies)',
                       'license': 'MIT', 'notices': [retain(vite / 'LICENSE.md', Path('vite/LICENSE.md'))]})
    rustdocs = Path(run('rustc', '--print', 'sysroot')) / 'share/doc/rust'
    rust_files = [rustdocs / 'COPYRIGHT-library.html', *sorted((rustdocs / 'licenses').glob('*.txt'))]
    if len(rust_files) < 2:
        raise ValueError('Rust distribution license texts are missing')
    components.append({'component': 'Rust standard library (distribution attribution; may include unused components)',
                       'license': 'See retained library copyright index',
                       'notices': [retain(p, Path('rust-toolchain') / p.relative_to(rustdocs)) for p in rust_files]})
    index = {'scope': __doc__.strip(), 'components': components, 'rust_normal_and_build_dependencies': registry}
    (OUT / 'third-party-notices.json').write_text(json.dumps(index, indent=2) + '\n', encoding='utf-8')
    lines = ['# Third-party notices', '', __doc__.strip(), '',
             'Original copyright headers and license alternatives are retained. Rust and Vite distribution notices are deliberately inclusive.',
             'Eclipse about notices can describe upstream dependencies not shipped here. The EPL-2.0 text retains its LICENSE-Pilot filename.',
             'No Monaco, Python, Pyodide or basedpyright assets are included.',
             'Exact files and hashes: [third-party-notices.json](third-party-notices.json).', '']
    for component in components + registry:
        lines += [f"- {component['component']}: {component['license']}. " + ', '.join(
            f"[{Path(n['path']).name}]({n['path']})" for n in component['notices'])]
    (OUT / 'THIRD_PARTY_NOTICES.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    shutil.copyfile(ROOT.parent / 'LICENSE', OUT / 'LICENSE')
    shutil.copyfile(ROOT / 'public/intersect_web.wasm', OUT / 'intersect_web.wasm')
    (OUT / 'alpha.html').rename(OUT / 'index.html')
    (OUT / 'README.txt').write_text(
        'Intersect 0.1.0-alpha.2 browser examples — evaluation and feedback\n\n'
        'Serve this entire directory with: python -m http.server 8000 --bind 127.0.0.1\n'
        'Open http://127.0.0.1:8000/ (file:// is unsupported). No build checkout,\n'
        'Internet service, Rust installation or Java runtime is needed to run it.\n'
        'The browser must support WebAssembly, module workers and secure-context crypto.\n\n'
        'Library and generic model/text editors only. History is in memory.\n'
        'Copy authored text to retain it; there is no project save/open interface.\n'
        'The broader gallery, Python workbench and custom hosts are not qualified here.\n'
        'See provenance.json and THIRD_PARTY_NOTICES.md for sources and attribution.\n'
        f"Build URL base: {os.environ.get('TOOLKIT_BASE', '/')}\n", encoding='utf-8')
    provenance = {
        'release': '0.1.0-alpha.2', 'examples_revision': run('git', 'rev-parse', 'HEAD', cwd=ROOT),
        'examples_tracked_changes': run('git', 'status', '--porcelain', '--untracked-files=normal', cwd=ROOT),
        'text': pin, 'model_revision': model_revision, 'rustc': run('rustc', '--version'),
        'node': run('node', '--version', cwd=ROOT), 'vite': vite_version,
        'text_lock_sha256': digest(RUNTIME / 'Cargo.lock'),
        'npm_lock_sha256': digest(ROOT / 'package-lock.json'),
        'base': os.environ.get('TOOLKIT_BASE', '/'), 'rust_target': 'wasm32-unknown-unknown',
        'rust_profile': 'release', 'cargo_host': 'intersect-web',
        'scope': 'Focused Library and model/text UI; source reconstruction, not project persistence',
        'files': {p.relative_to(OUT).as_posix(): digest(p) for p in sorted(OUT.rglob('*')) if p.is_file()},
    }
    (OUT / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n', encoding='utf-8')
    print(f"Retained {len(components)} input/toolchain components and {len(registry)} Rust dependency notices")


if __name__ == '__main__':
    main()
