"""
Windows service host for the PPE agent and the local console.

A real service registered with the SCM, via pywin32 -- not a third-party
wrapper. NSSM and WinSW are both fine tools, but both are binaries fetched from
a download site, and this has to install on plant PCs whose networks block
arbitrary downloads. pywin32 comes from PyPI, which is already required to
install anything here at all.

Two services, one module:

    PPEAgent    uvicorn serving the FastAPI app, in-process
    PPEConsole  the Next.js standalone console, as a child process

Usage (the installer does this; it is also the manual escape hatch):

    python -m app.service_win install-agent   --root C:\\PPEAgent --port 8004
    python -m app.service_win install-console --root C:\\PPEAgent --port 3000
    python -m app.service_win remove-agent
    python -m app.service_win remove-console

Restart-on-crash is configured through `sc.exe failure` after registration:
pywin32 exposes no API for the recovery settings, and a camera dropping at 3am
must not leave the service dead until somebody notices in the morning.
"""
from __future__ import annotations

import os
import subprocess
import sys
import threading

try:
    import servicemanager
    import win32event
    import win32service
    import win32serviceutil
except ImportError:  # pragma: no cover - non-Windows or pywin32 absent
    servicemanager = win32event = win32service = win32serviceutil = None


class _Base(win32serviceutil.ServiceFramework if win32serviceutil else object):
    """Shared start/stop plumbing.

    Config comes from the registry values pywin32 stores per service rather
    than from argv: the SCM starts a service with no useful command line, so
    anything the service needs to know has to be persisted at install time.
    """

    _svc_name_ = "PPEBase"
    _svc_display_name_ = "PPE Base"

    def __init__(self, args):
        win32serviceutil.ServiceFramework.__init__(self, args)
        self.stop_event = win32event.CreateEvent(None, 0, 0, None)
        self.root = self._opt("Root", "")
        self.port = self._opt("Port", "8004")
        self.host = self._opt("Host", "127.0.0.1")

    def _opt(self, name, default):
        try:
            return win32serviceutil.GetServiceCustomOption(
                self._svc_name_, name, default)
        except Exception:  # noqa: BLE001
            return default

    def SvcStop(self):  # noqa: N802 - pywin32 API
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        self.on_stop()
        win32event.SetEvent(self.stop_event)

    def SvcDoRun(self):  # noqa: N802 - pywin32 API
        servicemanager.LogMsg(
            servicemanager.EVENTLOG_INFORMATION_TYPE,
            servicemanager.PYS_SERVICE_STARTED,
            (self._svc_name_, ""))
        try:
            self.on_start()
        except Exception as exc:  # noqa: BLE001
            servicemanager.LogErrorMsg(f"{self._svc_name_} failed: {exc}")
            # Non-zero exit is what makes the SCM apply the recovery action;
            # returning cleanly would look like an intentional stop.
            self.ReportServiceStatus(win32service.SERVICE_STOPPED, win32ExitCode=1)
            return
        win32event.WaitForSingleObject(self.stop_event, win32event.INFINITE)

    def on_start(self):
        raise NotImplementedError

    def on_stop(self):
        pass


class PPEAgentService(_Base):
    _svc_name_ = "PPEAgent"
    _svc_display_name_ = "PPE Detection Agent"
    _svc_description_ = ("Local PPE detection: cameras, inference, recording. "
                         "Pushes violations to the cloud dashboard on request.")

    def on_start(self):
        if self.root:
            os.chdir(self.root)
            sys.path.insert(0, self.root)
            os.environ.setdefault("PPE_ROOT", self.root)

        import uvicorn

        from app.main import app

        config = uvicorn.Config(app, host=self.host, port=int(self.port),
                                log_level="info", access_log=False)
        self.server = uvicorn.Server(config)
        # In a thread so SvcStop can still be serviced; uvicorn's own signal
        # handling is meaningless under the SCM.
        self.thread = threading.Thread(target=self.server.run, daemon=True)
        self.thread.start()

    def on_stop(self):
        srv = getattr(self, "server", None)
        if srv is not None:
            srv.should_exit = True
        thread = getattr(self, "thread", None)
        if thread is not None:
            thread.join(timeout=25)


class PPEConsoleService(_Base):
    _svc_name_ = "PPEConsole"
    _svc_display_name_ = "PPE Control Room (local web console)"
    _svc_description_ = ("Serves the PPE console over http so wall displays and "
                         "phones on the plant network can use it.")

    def on_start(self):
        console = os.path.join(self.root, "console")
        node = os.path.join(self.root, "node.exe")
        if not os.path.exists(node):
            node = "node"

        env = dict(os.environ)
        env.update({
            # 0.0.0.0 regardless of the agent's binding: a console nobody else
            # can open is the same as no console. The AGENT bind is the security
            # decision, and it is the one behind the LAN key.
            "HOSTNAME": "0.0.0.0",
            "PORT": str(self.port),
            "NODE_ENV": "production",
            "NEXT_PUBLIC_PPE_AGENT_PORT": self._opt("AgentPort", "8004"),
            "NEXT_PUBLIC_PPE_LAN_KEY": self._opt("LanKey", ""),
        })
        log_dir = os.path.join(self.root, "data")
        os.makedirs(log_dir, exist_ok=True)
        self._out = open(os.path.join(log_dir, "console.log"), "ab", buffering=0)
        self.proc = subprocess.Popen(
            [node, "server.js"], cwd=console, env=env,
            stdout=self._out, stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))

    def on_stop(self):
        proc = getattr(self, "proc", None)
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=20)
            except Exception:  # noqa: BLE001
                proc.kill()
        out = getattr(self, "_out", None)
        if out is not None:
            try:
                out.close()
            except Exception:
                pass


# --------------------------------------------------------------------- install
def _set_recovery(name: str) -> None:
    """Restart on crash, with a delay and a reset window.

    pywin32 has no binding for the recovery tab, so this shells out. The delay
    matters: an agent whose camera is unreachable would otherwise crash-loop and
    fill the disk with logs, on the same disk the evidence lives on.
    """
    try:
        subprocess.run(
            ["sc.exe", "failure", name, "reset=", "3600",
             "actions=", "restart/5000/restart/15000/restart/60000"],
            check=False, capture_output=True)
    except Exception:  # noqa: BLE001
        pass


def _install(cls, root: str, port: str, host: str, extra: dict) -> None:
    exe = sys.executable
    # SCM starts services with cwd=System32, so `-m app.service_win` cannot
    # find the package. Write a tiny launcher under the install root (paths with
    # spaces like "Program Files" break fragile -c one-liners) and point the
    # service at that file.
    os.makedirs(root, exist_ok=True)
    svc_key = cls._svc_name_.lower()
    launcher = os.path.join(root, f"_svc_{svc_key}.py")
    with open(launcher, "w", encoding="ascii", newline="\n") as fh:
        fh.write(
            "# Auto-generated by PPE installer. Do not edit.\n"
            "import os\n"
            "import sys\n"
            f"ROOT = r'{root}'\n"
            "os.chdir(ROOT)\n"
            "if ROOT not in sys.path:\n"
            "    sys.path.insert(0, ROOT)\n"
            "from app.service_win import main\n"
            f"raise SystemExit(main(['svc', 'run-{svc_key}']))\n"
        )
    # Quote the launcher path so "Program Files" survives CreateService.
    win32serviceutil.InstallService(
        f"{cls.__module__}.{cls.__name__}",
        cls._svc_name_,
        cls._svc_display_name_,
        description=getattr(cls, "_svc_description_", ""),
        startType=win32service.SERVICE_AUTO_START,
        exeName=exe,
        exeArgs=f'"{launcher}"',
    )
    win32serviceutil.SetServiceCustomOption(cls._svc_name_, "Root", root)
    win32serviceutil.SetServiceCustomOption(cls._svc_name_, "Port", port)
    win32serviceutil.SetServiceCustomOption(cls._svc_name_, "Host", host)
    for k, v in (extra or {}).items():
        win32serviceutil.SetServiceCustomOption(cls._svc_name_, k, v)
    _set_recovery(cls._svc_name_)
    print(f"installed {cls._svc_name_} -> {launcher}")


def main(argv: list[str]) -> int:
    if win32serviceutil is None:
        print("pywin32 is required (pip install pywin32)", file=sys.stderr)
        return 2

    args = {a.split("=", 1)[0]: (a.split("=", 1)[1] if "=" in a else "")
            for a in argv[1:] if a.startswith("--")}
    cmd = argv[1] if len(argv) > 1 else ""
    root = args.get("--root") or os.getcwd()
    port = args.get("--port") or "8004"
    host = args.get("--host") or "127.0.0.1"

    if cmd == "install-agent":
        _install(PPEAgentService, root, port, host, {})
    elif cmd == "install-console":
        _install(PPEConsoleService, root, port, "0.0.0.0",
                 {"AgentPort": args.get("--agent-port") or "8004",
                  "LanKey": args.get("--lan-key") or ""})
    elif cmd == "remove-agent":
        win32serviceutil.RemoveService(PPEAgentService._svc_name_)
    elif cmd == "remove-console":
        win32serviceutil.RemoveService(PPEConsoleService._svc_name_)
    elif cmd == "run-ppeagent":
        servicemanager.Initialize()
        servicemanager.PrepareToHostSingle(PPEAgentService)
        servicemanager.StartServiceCtrlDispatcher()
    elif cmd == "run-ppeconsole":
        servicemanager.Initialize()
        servicemanager.PrepareToHostSingle(PPEConsoleService)
        servicemanager.StartServiceCtrlDispatcher()
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
