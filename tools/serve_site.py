"""Serve the assembled Pages artifact at its deployment prefix for verification."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--base', default='/')
    parser.add_argument('--port', type=int, default=4184)
    args = parser.parse_args()
    if not args.base.startswith('/') or not args.base.endswith('/'):
        parser.error('--base must start and end with /')

    class Handler(SimpleHTTPRequestHandler):
        def handle_at_prefix(self, parent):
            if not self.path.startswith(args.base):
                self.send_error(404)
                return
            self.path = '/' + self.path[len(args.base):]
            parent()

        def do_GET(self):
            self.handle_at_prefix(super().do_GET)

        def do_HEAD(self):
            self.handle_at_prefix(super().do_HEAD)

    server = ThreadingHTTPServer(('127.0.0.1', args.port),
                                partial(Handler, directory=str(args.directory.resolve())))
    server.serve_forever()


if __name__ == '__main__':
    main()
