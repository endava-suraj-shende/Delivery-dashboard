#!/usr/bin/env python
"""Single-command launcher for the Employee Delivery Dashboard.

    python run.py            # start backend + frontend (dev mode)
    python run.py --check    # only verify prerequisites
    python run.py --backend  # backend only
    python run.py --frontend # frontend only
    python run.py --install  # install missing Python / Node dependencies, then start

Works on Windows 10/11 and Linux. Press Ctrl+C to stop both processes.
"""
from __future__ import annotations

import argparse
import atexit
import importlib
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import List, Optional

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
LOCK = ROOT / ".run.lock"
IS_WIN = os.name == "nt"

BACKEND_HOST, BACKEND_PORT = "127.0.0.1", 8000
FRONTEND_PORT = 5173

PY_MODULES = {
    "fastapi": "fastapi", "uvicorn": "uvicorn", "pydantic": "pydantic", "pydantic_settings": "pydantic-settings",
    "pandas": "pandas", "numpy": "numpy", "openpyxl": "openpyxl", "reportlab": "reportlab", "multipart": "python-multipart",
    "sqlalchemy": "sqlalchemy", "alembic": "alembic", "argon2": "argon2-cffi", "jwt": "PyJWT",
}

C = {k: "" for k in ("g", "y", "r", "b", "d", "x")}
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # child output may contain non-cp1252 glyphs
    except Exception:
        pass
if sys.stdout.isatty():
    C.update(g="\033[92m", y="\033[93m", r="\033[91m", b="\033[94m", d="\033[2m", x="\033[0m")
    if IS_WIN:
        os.system("")  # enable ANSI on Windows terminals


def say(msg: str, color: str = "") -> None:
    print(f"{C.get(color, '')}{msg}{C['x']}", flush=True)


# --------------------------------------------------------------------------- checks
def check_python() -> bool:
    ok = sys.version_info >= (3, 10)
    say(f"[{'OK' if ok else 'FAIL'}] Python {sys.version.split()[0]} (3.10+ required)", "g" if ok else "r")
    return ok


def missing_python_packages() -> List[str]:
    missing = []
    for module, pkg in PY_MODULES.items():
        try:
            importlib.import_module(module)
        except ImportError:
            missing.append(pkg)
    return missing


def npm_cmd() -> Optional[str]:
    for name in (["npm.cmd", "npm"] if IS_WIN else ["npm"]):
        path = shutil.which(name)
        if path:
            return path
    return None


def check_node() -> bool:
    node = shutil.which("node")
    npm = npm_cmd()
    if not node or not npm:
        say("[FAIL] Node.js / npm not found. Install Node.js 18+ from https://nodejs.org/", "r")
        return False
    try:
        ver = subprocess.check_output([node, "--version"], text=True).strip()
    except Exception:
        ver = "?"
    say(f"[OK] Node.js {ver}", "g")
    return True


def frontend_deps_installed() -> bool:
    return (FRONTEND / "node_modules" / "vite").exists() or (FRONTEND / "node_modules" / ".bin").exists()


def port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex((host, port)) == 0


def run_checks(install: bool) -> bool:
    say("\nChecking prerequisites", "b")
    ok = check_python()
    missing = missing_python_packages()
    if missing:
        if install:
            say(f"Installing Python packages: {', '.join(missing)}", "y")
            subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", str(BACKEND / "requirements.txt")])
            missing = missing_python_packages()
    if missing:
        say(f"[FAIL] Missing Python packages: {', '.join(missing)}", "r")
        say(f"       Run:  {sys.executable} -m pip install -r backend/requirements.txt", "d")
        ok = False
    else:
        say("[OK] Python dependencies", "g")
    node_ok = check_node()
    ok = ok and node_ok
    if node_ok:
        if not frontend_deps_installed():
            if install:
                say("Installing frontend dependencies (npm install)...", "y")
                subprocess.check_call([npm_cmd(), "install"], cwd=FRONTEND)
            else:
                say("[FAIL] Frontend dependencies not installed.", "r")
                say("       Run:  cd frontend && npm install   (or: python run.py --install)", "d")
                ok = False
        if frontend_deps_installed():
            say("[OK] Frontend dependencies", "g")
    data_dir = ROOT / "Data"
    n = len(list(data_dir.rglob("*.xls*"))) if data_dir.exists() else 0
    say(f"[{'OK' if n else 'WARN'}] Data folder: {data_dir} ({n} workbook(s))", "g" if n else "y")
    return ok


# --------------------------------------------------------------------------- processes
class Proc:
    def __init__(self, name: str, cmd: List[str], cwd: Path, color: str) -> None:
        self.name, self.cmd, self.cwd, self.color = name, cmd, cwd, color
        self.proc: Optional[subprocess.Popen] = None

    def start(self) -> None:
        kwargs = {}
        if IS_WIN:
            kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            kwargs["start_new_session"] = True
        self.proc = subprocess.Popen(self.cmd, cwd=str(self.cwd), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                     text=True, encoding="utf-8", errors="replace", bufsize=1, **kwargs)
        threading.Thread(target=self._pump, daemon=True).start()

    def _pump(self) -> None:
        assert self.proc and self.proc.stdout
        for line in self.proc.stdout:
            try:
                sys.stdout.write(f"{C[self.color]}[{self.name}]{C['x']} {line}")
            except UnicodeEncodeError:
                sys.stdout.write(f"[{self.name}] {line.encode('ascii', 'replace').decode('ascii')}")
            sys.stdout.flush()

    def alive(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def stop(self) -> None:
        if not self.alive():
            return
        assert self.proc
        try:
            if IS_WIN:
                subprocess.run(["taskkill", "/PID", str(self.proc.pid), "/T", "/F"], capture_output=True)
            else:
                os.killpg(os.getpgid(self.proc.pid), signal.SIGTERM)
            self.proc.wait(timeout=8)
        except Exception:
            try:
                self.proc.kill()
            except Exception:
                pass


def acquire_lock() -> bool:
    if LOCK.exists():
        try:
            pid = int(LOCK.read_text().strip() or 0)
        except ValueError:
            pid = 0
        if pid and _pid_alive(pid):
            say(f"Another instance appears to be running (pid {pid}). Stop it first or delete {LOCK.name}.", "r")
            return False
    LOCK.write_text(str(os.getpid()))
    atexit.register(lambda: LOCK.unlink(missing_ok=True))
    return True


def _pid_alive(pid: int) -> bool:
    if IS_WIN:
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}"], capture_output=True, text=True).stdout
        return str(pid) in out
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description="Start the Employee Delivery Dashboard")
    ap.add_argument("--check", action="store_true", help="only check prerequisites")
    ap.add_argument("--install", action="store_true", help="install missing dependencies before starting")
    ap.add_argument("--backend", action="store_true", help="start backend only")
    ap.add_argument("--frontend", action="store_true", help="start frontend only")
    ap.add_argument("--reload", action="store_true", help="enable backend auto-reload (development)")
    args = ap.parse_args()

    say("Employee Project & Delivery Performance Reporting Dashboard", "b")
    if not run_checks(args.install):
        return 1
    if args.check:
        return 0
    if not acquire_lock():
        return 1

    start_backend = not args.frontend
    start_frontend = not args.backend
    if start_backend and port_in_use(BACKEND_PORT):
        say(f"Port {BACKEND_PORT} is already in use - is the backend already running?", "r")
        return 1
    if start_frontend and port_in_use(FRONTEND_PORT):
        say(f"Port {FRONTEND_PORT} is already in use - is the frontend already running?", "r")
        return 1

    procs: List[Proc] = []
    if start_backend:
        cmd = [sys.executable, "-m", "uvicorn", "app.main:app", "--host", BACKEND_HOST, "--port", str(BACKEND_PORT)]
        if args.reload:
            cmd.append("--reload")
        procs.append(Proc("backend", cmd, BACKEND, "g"))
    if start_frontend:
        procs.append(Proc("frontend", [npm_cmd(), "run", "dev", "--", "--host", "localhost", "--port", str(FRONTEND_PORT)], FRONTEND, "b"))

    def shutdown(*_: object) -> None:
        say("\nShutting down...", "y")
        for p in reversed(procs):
            p.stop()
        LOCK.unlink(missing_ok=True)

    atexit.register(shutdown)
    for p in procs:
        p.start()

    say("\nStarting services...", "b")
    deadline = time.time() + 60
    while time.time() < deadline:
        be_ok = (not start_backend) or port_in_use(BACKEND_PORT)
        fe_ok = (not start_frontend) or port_in_use(FRONTEND_PORT)
        if be_ok and fe_ok:
            break
        if any(not p.alive() for p in procs):
            break
        time.sleep(0.5)

    print()
    say("=" * 64, "d")
    if start_backend:
        say(f"  Backend:   http://{BACKEND_HOST}:{BACKEND_PORT}", "g")
        say(f"  API Docs:  http://{BACKEND_HOST}:{BACKEND_PORT}/docs", "g")
    if start_frontend:
        say(f"  Frontend:  http://localhost:{FRONTEND_PORT}", "g")
    say("  Press Ctrl+C to stop.", "d")
    say("=" * 64, "d")
    print()

    try:
        while True:
            for p in procs:
                if not p.alive():
                    say(f"{p.name} exited with code {p.proc.returncode if p.proc else '?'}; stopping.", "r")
                    shutdown()
                    return 1
            time.sleep(1)
    except KeyboardInterrupt:
        shutdown()
        return 0


if __name__ == "__main__":
    sys.exit(main())
