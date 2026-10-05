"""Argv lists for the tiny commands the terminal tests spawn, runnable without a POSIX userland."""

import os
import sys

if os.name == "nt":
    _PY = [sys.executable, "-u", "-c"]
    ECHO = [*_PY, "import sys; [print(l, end='', flush=True) for l in sys.stdin]"]
    PWD = [*_PY, "import os; print(os.getcwd())"]
    QUICK = [*_PY, "pass"]
    SLEEPY = [*_PY, "import time; time.sleep(5)"]
else:
    ECHO = ["cat"]
    PWD = ["sh", "-c", "pwd"]
    QUICK = ["true"]
    SLEEPY = ["sleep", "5"]
