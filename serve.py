#!/usr/bin/env python3
"""Servidor estático local com suporte a HTTP Range (necessário para scrub de vídeo).

Uso: python3 serve.py [porta] [diretório] [--lan]

O http.server padrão do Python ignora Range e o Chrome não consegue fazer seek
no vídeo — o que congela as LPs com história em scrub.

Escuta apenas em 127.0.0.1. O --lan abre para a rede local (0.0.0.0) — só use
sabendo que TODO o diretório servido fica legível para qualquer máquina da
rede, incluindo um .git/ se houver.
"""
import argparse
import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# Correspondência integral, dígitos limitados: o que não casar aqui é tratado
# como a RFC 9110 manda — o header é ignorado e o arquivo vai inteiro (200).
# Isso cobre multi-range, unidade desconhecida, invertido e lixo.
RANGE_RE = re.compile(r"^bytes=(\d{0,15})-(\d{0,15})$")


def resolver_range(header, size):
    """(start, end) para servir, None para ignorar o header, 416 via ValueError."""
    m = RANGE_RE.match(header.strip())
    if not m or (not m.group(1) and not m.group(2)):
        return None
    if not m.group(1):  # bytes=-N: os ÚLTIMOS N bytes
        sufixo = int(m.group(2))
        if sufixo <= 0 or size == 0:
            raise ValueError
        return max(0, size - sufixo), size - 1
    start = int(m.group(1))
    end = int(m.group(2)) if m.group(2) else size - 1
    if m.group(2) and end < start:
        return None  # invertido é sintaxe inválida: ignora, não 416
    if start >= size or size == 0:
        raise ValueError
    return start, min(end, size - 1)


class RangeHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def send_head(self):
        path = self.translate_path(self.path)
        rng = self.headers.get("Range")
        if not rng or os.path.isdir(path):
            return super().send_head()
        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None
        size = os.fstat(f.fileno()).st_size
        try:
            resolvido = resolver_range(rng, size)
        except ValueError:
            f.close()
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None
        if resolvido is None:
            f.close()
            return super().send_head()
        start, end = resolvido
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


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Servidor estático local com HTTP Range para scrub de vídeo.")
    parser.add_argument("porta", nargs="?", type=int, default=8090)
    parser.add_argument("diretorio", nargs="?", default=None,
                        help="relativo a este arquivo; padrão é o diretório dele")
    parser.add_argument("--lan", action="store_true",
                        help="escuta em 0.0.0.0 (expõe o diretório à rede local)")
    args = parser.parse_args()

    raiz = os.path.dirname(os.path.abspath(__file__))
    if args.diretorio:
        raiz = os.path.join(raiz, args.diretorio)
        if not os.path.isdir(raiz):
            sys.exit(f"ERRO: {raiz} não existe.")
    os.chdir(raiz)
    host = "0.0.0.0" if args.lan else "127.0.0.1"
    srv = ThreadingHTTPServer((host, args.porta), RangeHandler)
    print(f"Servindo {os.getcwd()} em http://localhost:{args.porta} (com Range)"
          + (" — EXPOSTO À REDE LOCAL" if args.lan else ""))
    srv.serve_forever()
