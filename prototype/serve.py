#!/usr/bin/env python3
"""Serve the prototype folder locally, with HTTP Range support for audio.

Python's built-in http.server ignores Range requests, which breaks seeking in
hour-long files, so this small server handles them. Audio and spectrograms are
served from this folder (see build_test_data.py), so no CORS rules are needed.

    python3 prototype/serve.py            # http://127.0.0.1:8790/
    python3 prototype/serve.py 9000
"""

import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=HERE, **kwargs)

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_head(self):
        path = self.translate_path(self.path)
        range_header = self.headers.get("Range")
        if not range_header or not os.path.isfile(path):
            return super().send_head()
        match = re.match(r"bytes=(\d*)-(\d*)$", range_header.strip())
        size = os.path.getsize(path)
        if not match or (not match.group(1) and not match.group(2)):
            return super().send_head()
        if match.group(1):
            start = int(match.group(1))
            end = int(match.group(2)) if match.group(2) else size - 1
        else:
            start = max(0, size - int(match.group(2)))
            end = size - 1
        end = min(end, size - 1)
        if start > end or start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None
        handle = open(path, "rb")
        handle.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self._remaining = end - start + 1
        return handle

    def copyfile(self, source, outputfile):
        remaining = getattr(self, "_remaining", None)
        if remaining is None:
            return super().copyfile(source, outputfile)
        while remaining > 0:
            chunk = source.read(min(1 << 16, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)
        self._remaining = None

    def log_message(self, fmt, *args):
        if "/audio/" in self.path and "GET" in fmt:
            return  # one line per media chunk is noise
        super().log_message(fmt, *args)


Handler.extensions_map.update({".opus": "audio/ogg", ".json": "application/json", ".js": "text/javascript"})


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Prototype at http://127.0.0.1:{port}/  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
