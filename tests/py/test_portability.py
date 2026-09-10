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


def text_io_calls(tree: ast.AST):
    """Every call that opens a file in text mode, with its keywords."""
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        name = (node.func.attr if isinstance(node.func, ast.Attribute)
                else node.func.id if isinstance(node.func, ast.Name) else None)
        if name not in TEXT_CALLS:
            continue
        binary = any(isinstance(a, ast.Constant) and isinstance(a.value, str) and "b" in a.value
                     for a in node.args)
        if not binary:
            yield name, node


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
            for name, node in text_io_calls(tree):
                kw = {k.arg: k.value for k in node.keywords}
                enc = kw.get("encoding")
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
