"""Things that only break on Windows, guarded from a Mac.

Every one of these shipped as a real bug: text I/O that silently used the
console code page, a JWT signed by a binary Windows does not have, and a
`python3` that resolves to a Microsoft Store stub. They are cheap to assert
and expensive to rediscover.
"""
import ast
import unittest
from pathlib import Path

import _paths  # noqa: F401

REPO = Path(__file__).resolve().parent.parent.parent
SOURCES = sorted(
    p for d in ("ingest", "ops", "probes", "tests/py")
    for p in (REPO / d).glob("*.py")
)
TEXT_CALLS = {"read_text", "write_text", "open"}


def _arg(node: ast.Call, pos: int | None, kw: str):
    """One argument of a call, by keyword or by position."""
    for k in node.keywords:
        if k.arg == kw:
            return k.value
    if pos is not None and len(node.args) > pos:
        return node.args[pos]
    return None


def text_io_calls(tree: ast.AST):
    """Every call that opens a file in text mode, with its encoding argument.

    Argument positions differ per call and getting them wrong is not
    theoretical: an earlier version of this scanned every positional argument
    for a "b" to detect binary mode, which made `write_text("Appended by …")`
    look like a binary write and hid a real bug from this test.
    """
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        attr = isinstance(node.func, ast.Attribute)
        name = (node.func.attr if attr
                else node.func.id if isinstance(node.func, ast.Name) else None)
        if name == "open":
            # builtin open(file, mode, buffering, encoding); Path.open(mode, buffering, encoding)
            mode = _arg(node, 0 if attr else 1, "mode")
            enc = _arg(node, 2 if attr else 3, "encoding")
        elif name == "read_text":     # read_text(encoding, errors)
            mode, enc = None, _arg(node, 0, "encoding")
        elif name == "write_text":    # write_text(data, encoding, errors)
            mode, enc = None, _arg(node, 1, "encoding")
        else:
            continue
        if isinstance(mode, ast.Constant) and "b" in str(mode.value):
            continue
        yield name, node, enc


class PortabilityTests(unittest.TestCase):
    def test_sources_were_found(self):
        # A glob that silently matches nothing would make every test below
        # pass while checking nothing.
        self.assertGreater(len(SOURCES), 20, "the source glob found almost nothing")

    def test_every_text_file_call_names_its_encoding(self):
        """Python defaults to the locale encoding, which is cp1252 on a stock
        Windows install. Search Console queries are full of non-ASCII, so an
        unqualified write_text raises UnicodeEncodeError and takes the daily
        run down — on that machine only."""
        missing = []
        for path in SOURCES:
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for name, node, enc in text_io_calls(tree):
                if not (isinstance(enc, ast.Constant) and str(enc.value).lower() in ("utf-8", "utf8")):
                    missing.append(f"{path.relative_to(REPO)}:{node.lineno}  {name}()")
        self.assertEqual(missing, [], "add encoding=\"utf-8\":\n  " + "\n  ".join(missing))

    def test_no_openssl_subprocess_in_the_runtime(self):
        """The service-account JWT is signed with node's crypto module. The
        tests may still call openssl to verify a signature independently;
        shipped code may not, because Windows has no openssl."""
        offenders = []
        for path in SOURCES:
            if path.parent.name == "py":  # tests/py verify against openssl on purpose
                continue
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                # A string literal that *is* the binary name, so prose about
                # having removed openssl does not trip this.
                if isinstance(node, ast.Constant) and isinstance(node.value, str):
                    v = node.value.strip().lower()
                    if v == "openssl" or v.endswith("/openssl") or v.endswith("openssl.exe"):
                        offenders.append(f"{path.relative_to(REPO)}:{node.lineno}")
        self.assertEqual(offenders, [], "openssl is not available on Windows:\n  " + "\n  ".join(offenders))

    def test_stdout_is_utf8_after_importing_the_config(self):
        import sys
        import seo_config  # noqa: F401
        self.assertEqual((sys.stdout.encoding or "").lower().replace("-", ""), "utf8")


if __name__ == "__main__":
    unittest.main()
