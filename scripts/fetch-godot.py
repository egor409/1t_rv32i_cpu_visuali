#!/usr/bin/env python3
"""
Скачивает Godot (headless-редактор для Linux) и ТОЛЬКО шаблон веб-экспорта.

Полный архив шаблонов экспорта весит ~1 ГБ; отсюда по HTTP Range читается лишь нужный
файл web_nothreads_release.zip (~10 МБ), поэтому скрипт годится и для CI.

  python3 scripts/fetch-godot.py [каталог]   (по умолчанию .godot-bin/)

Результат:
  <каталог>/godot                                   — исполняемый файл редактора
  ~/.local/share/godot/export_templates/<ver>/      — web_nothreads_release.zip, version.txt
"""
import io
import os
import stat
import sys
import urllib.request
import zipfile

VERSION = "4.3"
TAG = f"{VERSION}-stable"
TPL_DIR_NAME = f"{VERSION}.stable"
BASE = f"https://github.com/godotengine/godot/releases/download/{TAG}"
EDITOR = f"Godot_v{TAG}_linux.x86_64"
TEMPLATES = f"Godot_v{TAG}_export_templates.tpz"
WANT = ["templates/web_nothreads_release.zip", "templates/version.txt"]


class HttpRangeFile(io.RawIOBase):
    """Файл «только для чтения» поверх HTTP Range-запросов (для zipfile)."""

    def __init__(self, url: str):
        self.url = url
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req) as r:
            self.url = r.geturl()  # после редиректов
            self.size = int(r.headers["Content-Length"])
        self.pos = 0

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = {0: off, 1: self.pos + off, 2: self.size + off}[whence]
        return self.pos

    def readinto(self, b):
        n = min(len(b), self.size - self.pos)
        if n <= 0:
            return 0
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{self.pos + n - 1}"})
        with urllib.request.urlopen(req) as r:
            data = r.read()
        b[: len(data)] = data
        self.pos += len(data)
        return len(data)


def main():
    out = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".godot-bin")
    os.makedirs(out, exist_ok=True)
    exe = os.path.join(out, "godot")
    if not os.path.exists(exe):
        print(f"→ редактор {EDITOR}")
        data = urllib.request.urlopen(f"{BASE}/{EDITOR}.zip").read()
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            with z.open(EDITOR) as src, open(exe, "wb") as dst:
                dst.write(src.read())
        os.chmod(exe, os.stat(exe).st_mode | stat.S_IEXEC)

    tpl = os.path.join(os.path.expanduser("~/.local/share/godot/export_templates"), TPL_DIR_NAME)
    os.makedirs(tpl, exist_ok=True)
    missing = [w for w in WANT if not os.path.exists(os.path.join(tpl, os.path.basename(w)))]
    if missing:
        print(f"→ шаблоны веб-экспорта из {TEMPLATES} (выборочно)")
        f = io.BufferedReader(HttpRangeFile(f"{BASE}/{TEMPLATES}"), buffer_size=1 << 20)
        with zipfile.ZipFile(f) as z:
            for name in missing:
                with z.open(name) as src, open(os.path.join(tpl, os.path.basename(name)), "wb") as dst:
                    dst.write(src.read())
    print(f"готово: {exe}\n        {tpl}")


if __name__ == "__main__":
    main()
