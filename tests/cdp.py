"""Cliente minimo do Chrome DevTools Protocol em stdlib pura.

Fala com um Chrome aberto com --remote-debugging-port. Sem dependencias:
o WebSocket (RFC 6455, lado cliente, frames de texto) e implementado aqui.
Uso tipico:
    c = CDP.connect()          # descobre host (gateway WSL) e primeira aba
    c.navigate("https://...")
    c.screenshot(Path("tela.png"))
    c.eval_js("document.title")
    c.click(x, y); c.type_text("ola")
"""
import base64
import json
import os
import re
import socket
import struct
import subprocess
import time
import urllib.request
from pathlib import Path

DEFAULT_PORT = 9223  # portproxy do Windows para o CDP local (9222)


class CDPError(RuntimeError):
    pass


def _gateway():
    try:
        out = subprocess.run(["ip", "route", "show", "default"],
                             capture_output=True, text=True, timeout=5).stdout.split()
        return out[out.index("via") + 1] if "via" in out else None
    except OSError:
        return None


def discover_host(port=DEFAULT_PORT):
    """Ordem: $CDP_HOST > localhost > gateway default do WSL."""
    candidates = [h for h in (os.environ.get("CDP_HOST"), "127.0.0.1", _gateway()) if h]
    for host in candidates:
        try:
            with urllib.request.urlopen(f"http://{host}:{port}/json/version", timeout=3):
                return host
        except OSError:
            continue
    raise CDPError("CDP nao respondeu. Chrome aberto com --remote-debugging-port? "
                   "portproxy 9223 criado? (testados: %s)" % ", ".join(candidates))


def encode_text_frame(data, mask):
    """Frame WebSocket de texto, mascarado (cliente->servidor), RFC 6455."""
    header = b"\x81"  # FIN + opcode texto
    n = len(data)
    if n < 126:
        header += bytes([0x80 | n])
    elif n < 65536:
        header += bytes([0x80 | 126]) + struct.pack(">H", n)
    else:
        header += bytes([0x80 | 127]) + struct.pack(">Q", n)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
    return header + mask + masked


def rewrite_ws_url(ws_url, host, port):
    """/json/list devolve ws://127.0.0.1:9222/...; troca pelo endpoint acessivel."""
    return re.sub(r"ws://[^/]+", "ws://%s:%s" % (host, port), ws_url)


class _WebSocket:
    """Cliente WebSocket minimo: handshake HTTP + frames de texto com mascara."""

    def __init__(self, url, timeout=120):
        m = re.match(r"ws://([^:/]+):(\d+)(/.*)", url)
        if not m:
            raise CDPError("url ws invalida: %s" % url)
        host, port, path = m.group(1), int(m.group(2)), m.group(3)
        self.sock = socket.create_connection((host, port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\n"
               "Upgrade: websocket\r\nConnection: Upgrade\r\n"
               f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
        self.sock.sendall(req.encode())
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise CDPError("handshake ws falhou (conexao fechada)")
            resp += chunk
        if b" 101 " not in resp.split(b"\r\n", 1)[0]:
            raise CDPError("handshake ws recusado: %s" % resp[:200])

    def _recv_exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise CDPError("conexao ws fechada no meio de um frame")
            buf += chunk
        return buf

    def send_text(self, payload):
        self.sock.sendall(encode_text_frame(payload.encode(), os.urandom(4)))

    def recv_text(self):
        """Le frames ate completar uma mensagem de texto (ignora ping/pong)."""
        while True:
            b1, b2 = self._recv_exact(2)
            opcode = b1 & 0x0F
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._recv_exact(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._recv_exact(8))[0]
            data = self._recv_exact(n) if n else b""
            if opcode == 0x9:  # ping -> pong
                self.sock.sendall(b"\x8A\x00")
                continue
            if opcode == 0x8:
                raise CDPError("servidor ws fechou a conexao")
            if opcode in (0x1, 0x0):
                return data.decode()
            # binario/pong: ignora

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


class CDP:
    def __init__(self, ws_url):
        self.ws = _WebSocket(ws_url)
        self._id = 0

    @classmethod
    def connect(cls, port=DEFAULT_PORT, url_filter=None):
        """Conecta na primeira aba 'page' (ou na que casar com url_filter)."""
        host = discover_host(port)
        with urllib.request.urlopen(f"http://{host}:{port}/json/list", timeout=5) as r:
            targets = json.load(r)
        pages = [t for t in targets if t.get("type") == "page"]
        if url_filter:
            pages = [t for t in pages if url_filter in t.get("url", "")] or pages
        if not pages:
            raise CDPError("nenhuma aba encontrada")
        ws_url = rewrite_ws_url(pages[0]["webSocketDebuggerUrl"], host, port)
        return cls(ws_url)

    def call(self, method, timeout_s=60, **params):
        self._id += 1
        self.ws.send_text(json.dumps({"id": self._id, "method": method, "params": params}))
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            msg = json.loads(self.ws.recv_text())
            if msg.get("id") == self._id:
                if "error" in msg:
                    raise CDPError("%s: %s" % (method, msg["error"]))
                return msg.get("result", {})
            # eventos assincronos sao ignorados
        raise CDPError("timeout aguardando resposta de %s" % method)

    def navigate(self, url, settle=2.0):
        self.call("Page.enable")
        self.call("Page.navigate", url=url)
        time.sleep(settle)

    def eval_js(self, expression, timeout_s=30):
        r = self.call("Runtime.evaluate", timeout_s=timeout_s, expression=expression,
                      returnByValue=True, awaitPromise=True)
        return r.get("result", {}).get("value")

    def screenshot(self, dest):
        r = self.call("Page.captureScreenshot", timeout_s=60, format="png")
        dest = Path(dest)
        dest.write_bytes(base64.b64decode(r["data"]))
        return dest

    def click(self, x, y):
        for kind in ("mousePressed", "mouseReleased"):
            self.call("Input.dispatchMouseEvent", type=kind, x=x, y=y,
                      button="left", clickCount=1)

    def type_text(self, text):
        for ch in text:
            self.call("Input.dispatchKeyEvent", type="keyDown", text=ch)
            self.call("Input.dispatchKeyEvent", type="keyUp")

    def close(self):
        self.ws.close()
