# PyInstaller spec for the frozen graph bridge shipped inside the Electron desktop app.
import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all

PROJECT_ROOT = Path(SPECPATH).resolve().parent

# 🔴 Imported, never re-typed: a hand-kept copy of this list is what silently dropped
# codechroma-impact and codechroma-impact-review from every frozen build.
sys.path.insert(0, str(PROJECT_ROOT / "src"))
from codechroma.bridge.skill_sync import SKILL_NAMES  # noqa: E402

datas = []
binaries = []
hiddenimports = []

# Native grammars and package data these libs load at runtime, invisible to static analysis.
for package in (
    "tree_sitter",
    "tree_sitter_python",
    "tree_sitter_typescript",
    "tree_sitter_go",
    "uvicorn",
    "watchfiles",
    "anthropic",
    "pyte",
    "pywinpty",
):
    package_datas, package_binaries, package_hiddenimports = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hiddenimports

# The dirs bridge/resources.py resolves under codechroma_data/ when frozen; skills are named
# individually so unrelated skills in this repo's .claude/skills don't ship to users.
datas += [(str(PROJECT_ROOT / "web" / "dist"), "codechroma_data/web")]
for skill in SKILL_NAMES:
    datas.append((str(PROJECT_ROOT / ".claude" / "skills" / skill), f"codechroma_data/skills/{skill}"))
# The runtime plugin directory shares the bundled skills above; it is loaded only for Claude agents.
datas.append(
    (
        str(PROJECT_ROOT / ".claude" / ".claude-plugin"),
        "codechroma_data/.claude-plugin",
    )
)
# Agent status manifests, read at runtime by bridge/agents/status.py via resource_path("detect").
datas.append(
    (str(PROJECT_ROOT / "src" / "codechroma" / "bridge" / "agents" / "detect"), "codechroma_data/detect")
)
# codechroma/prompts/__init__.py reads these straight off disk (Path(__file__).parent), not through
# resource_path(), so they must land next to the frozen module at codechroma/prompts/, not under
# codechroma_data/.
datas.append((str(PROJECT_ROOT / "src" / "codechroma" / "prompts"), "codechroma/prompts"))

analysis = Analysis(
    [str(PROJECT_ROOT / "packaging" / "bridge_main.py")],
    pathex=[str(PROJECT_ROOT / "src")],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter"],
    noarchive=False,
)
pyz = PYZ(analysis.pure)
exe = EXE(
    pyz,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="codechroma-bridge",
    console=True,
    target_arch=os.environ.get(
        "CODECHROMA_PYINSTALLER_TARGET_ARCH",
        "arm64" if sys.platform == "darwin" else None,
    ),
)
COLLECT(
    exe,
    analysis.binaries,
    analysis.datas,
    name="codechroma-bridge",
)
