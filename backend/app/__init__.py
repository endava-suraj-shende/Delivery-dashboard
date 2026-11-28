# Sibling top-level packages (../intelligence) are importable from the backend without installing them.
import sys as _sys
from pathlib import Path as _Path

_PROJECT_ROOT = str(_Path(__file__).resolve().parents[2])
if _PROJECT_ROOT not in _sys.path:
    _sys.path.append(_PROJECT_ROOT)
