#!/usr/bin/env python3
"""Минимальный статический сервер для локального запуска приложения.
Запуск:  python3 serve.py [порт]   (по умолчанию 8000)
"""
import os
import sys

# Переходим в директорию этого файла, чтобы корень раздачи был стабильным.
os.chdir(os.path.dirname(os.path.abspath(__file__)))

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", "8000"))
httpd = ThreadingHTTPServer(("0.0.0.0", port), SimpleHTTPRequestHandler)
print(f"Serving on http://localhost:{port}")
httpd.serve_forever()
