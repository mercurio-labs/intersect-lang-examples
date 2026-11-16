"""Milestone qualification of the downloaded Library fixture's load/edit/build/unpack workflow."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path, required=True)
    parser.add_argument('--target-dir', type=Path, required=True)
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    project = args.project.resolve()
    command = ['cargo', 'run', '--locked', '--manifest-path', str(project / 'Cargo.toml'),
               '--target-dir', str(args.target_dir.resolve())]
    if args.offline:
        command.append('--offline')

    def run(*arguments, valid=True):
        result = subprocess.run(command + ['--', *map(str, arguments)], cwd=project,
                                capture_output=True, text=True)
        if valid and result.returncode:
            raise RuntimeError(result.stdout + result.stderr)
        if not valid and not result.returncode:
            raise AssertionError('Invalid operation unexpectedly succeeded')
        return result.stdout + result.stderr

    def output():
        return json.loads((project / 'output/model.json').read_text(encoding='utf-8'))

    assert 'unpack' in run('--help')
    run('load', project / 'model.pack')
    original = output()
    assert original['model'] == json.loads((project / 'model.json').read_text(encoding='utf-8'))
    assert 'intersect.toolkit.runner' in run('inspect', project / 'model.pack')

    # This helper owns a unique scratch directory next to the downloaded project.
    # Resolve its parent before creation; TemporaryDirectory cleans only that directory.
    scratch_parent = project.parent.resolve()
    with tempfile.TemporaryDirectory(prefix='runner-workflows-', dir=scratch_parent) as temporary:
        scratch = Path(temporary).resolve()
        assert scratch.parent == scratch_parent
        editable = scratch / 'editable'
        run('unpack', project / 'model.pack', editable)
        config = json.loads((editable / 'project.json').read_text(encoding='utf-8'))
        regenerated = scratch / 'regenerated.pack'
        run('build', editable / 'project.json', regenerated)
        run('load', regenerated)
        assert output()['model'] == original['model']
        assert output()['derived'] == original['derived']
        run('unpack', project / 'model.pack', editable, valid=False)

        catalog = next(editable / row['file'] for row in config['models']
                       if 'A Wizard of Earthsea' in (editable / row['file']).read_text(encoding='utf-8'))
        catalog.write_text(catalog.read_text(encoding='utf-8').replace('A Wizard of Earthsea', 'Native runner edition'), encoding='utf-8', newline='')
        run('build', editable / 'project.json', regenerated)
        run('load', regenerated)
        assert 'Native runner edition' in json.dumps(output()['model'])

        metamodel = next(editable / row['file'] for row in config['definitions']
                         if 'class BookCopy extends Named {' in (editable / row['file']).read_text(encoding='utf-8'))
        metamodel.write_text(metamodel.read_text(encoding='utf-8').replace(
            'class BookCopy extends Named {', 'class BookCopy extends Named {\n    attr shelf: String [0,1];', 1), encoding='utf-8', newline='')
        run('build', editable / 'project.json', regenerated)
        run('load', regenerated)
        assert output()['model']['schema_revision'] != original['model']['schema_revision']
        assert 'Native runner edition' in json.dumps(output()['model'])

        good_pack = regenerated.read_bytes()
        good_source = catalog.read_bytes()
        catalog.write_text('invalid model text', encoding='utf-8')
        assert 'validation failed' in run('build', editable / 'project.json', regenerated, valid=False)
        assert regenerated.read_bytes() == good_pack
        catalog.write_bytes(good_source)
        metamodel.write_text('invalid Rcore', encoding='utf-8')
        run('build', editable / 'project.json', regenerated, valid=False)
        assert regenerated.read_bytes() == good_pack
        corrupt = bytearray(good_pack)
        corrupt[-1] ^= 1
        (scratch / 'corrupt.pack').write_bytes(corrupt)
        run('load', scratch / 'corrupt.pack', valid=False)

    # Both short example programs compile and execute from the extracted ZIP.
    for example in ('load_pack', 'build_pack'):
        subprocess.run(command + ['--example', example], cwd=project, check=True,
                       capture_output=True, text=True)
    print('Passed: load, inspect, unpack, unchanged rebuild, model edits, definition edits, '
          'invalid-source preservation, corrupt-pack rejection, and both Rust examples.')


if __name__ == '__main__':
    main()
