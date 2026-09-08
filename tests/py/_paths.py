"""Make ingest/ and ops/ importable from the tests, whatever the cwd."""
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
for d in ("ingest", "ops", "probes"):
    p = str(REPO / d)
    if p not in sys.path:
        sys.path.insert(0, p)
