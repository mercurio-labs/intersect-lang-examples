"""Verify that Pages-prefix checks cannot silently load root-relative assets."""
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path


class SitePrefixTests(unittest.TestCase):
    def test_prefixed_assets_work_and_origin_root_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'asset.js').write_text('verified asset', encoding='utf-8')
            with socket.socket() as reservation:
                reservation.bind(('127.0.0.1', 0))
                port = reservation.getsockname()[1]
            process = subprocess.Popen(
                [sys.executable, '-B', str(Path(__file__).with_name('serve_site.py')),
                 '--directory', directory, '--base', '/project/', '--port', str(port)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            try:
                url = f'http://127.0.0.1:{port}'
                for attempt in range(100):
                    try:
                        with urllib.request.urlopen(url + '/project/asset.js', timeout=1) as response:
                            self.assertEqual(response.read(), b'verified asset')
                        break
                    except urllib.error.HTTPError as error:
                        self.fail(f'Prefixed asset returned HTTP {error.code}')
                    except urllib.error.URLError:
                        if process.poll() is not None:
                            self.fail('Site server exited before verification')
                        time.sleep(0.05)
                else:
                    self.fail('Site server did not become ready')
                with self.assertRaises(urllib.error.HTTPError) as refused:
                    urllib.request.urlopen(url + '/asset.js')
                self.assertEqual(refused.exception.code, 404)
                with urllib.request.urlopen(urllib.request.Request(url + '/project/asset.js', method='HEAD')) as response:
                    self.assertEqual(response.status, 200)
            finally:
                process.terminate()
                process.wait(timeout=5)


if __name__ == '__main__':
    unittest.main()
