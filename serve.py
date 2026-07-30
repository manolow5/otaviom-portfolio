#!/usr/bin/env python3
"""Servidor estático com suporte a HTTP Range (necessário para scrub de vídeo).

Uso: python3 serve.py [porta]  (padrão 8090)
O http.server padrão do Python ignora Range e o Chrome não consegue
fazer seek no vídeo — o que congela as LPs com história em scrub.
"""
import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


class RangeHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()
        rng = self.headers.get("Range")
        if not rng:
            return super().send_head()
        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None
        size = os.fstat(f.fileno()).st_size
        m = RANGE_RE.match(rng)
        if not m:
            f.close()
            self.send_error(400, "Invalid Range")
            return None
        start = int(m.group(1)) if m.group(1) else 0
        end = int(m.group(2)) if m.group(2) else size - 1
        end = min(end, size - 1)
        if start > end or start >= size:
            f.close()
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return None
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        f.seek(start)
        self._range_remaining = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        remaining = getattr(self, "_range_remaining", None)
        if remaining is None:
            return super().copyfile(source, outputfile)
        self._range_remaining = None
        while remaining > 0:
            chunk = source.read(min(64 * 1024, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)

    def end_headers(self):
        if "Accept-Ranges" not in getattr(self, "_headers_buffer_names", []):
            pass
        super().end_headers()


if __name__ == "__main__":
    # Uso: serve.py [porta] [diretório]
    # O diretório é relativo ao repo. Serve para ver o portfólio nas mesmas URLs
    # de produção (serve.py 8090 portfolio/public), em vez de sob /portfolio/public/.
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
    raiz = os.path.dirname(os.path.abspath(__file__))
    if len(sys.argv) > 2:
        raiz = os.path.join(raiz, sys.argv[2])
        if not os.path.isdir(raiz):
            sys.exit(f"ERRO: {raiz} não existe.")
    os.chdir(raiz)
    srv = ThreadingHTTPServer(("0.0.0.0", port), RangeHandler)
    print(f"Servindo {os.getcwd()} em http://localhost:{port} (com Range)")
    srv.serve_forever()
