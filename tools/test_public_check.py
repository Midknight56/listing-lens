"""Proves the public check's new scans fire. Each case plants one fault in a throwaway git repo and expects FAIL.

    python tools/test_public_check.py
"""
import importlib.util
import pathlib
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent


def load(root):
    spec = importlib.util.spec_from_file_location("public_check", HERE / "public_check.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.ROOT = root
    return module


def repo(files):
    root = pathlib.Path(tempfile.mkdtemp())
    git = lambda *a: subprocess.run(["git", *a], cwd=root, capture_output=True, check=True)
    git("init", "-q")
    git("config", "user.email", "test@example.com")
    git("config", "user.name", "test")
    (root / "LICENSE").write_text("MIT License\n", encoding="utf-8")
    for name, text in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    git("add", "-A")
    git("commit", "-q", "-m", "fixture")
    return root


def run(root, secrets):
    module = load(root)
    sys.argv = ["public_check.py", "--secrets-dir", str(secrets)]
    return module.main()


def main():
    empty = pathlib.Path(tempfile.mkdtemp())
    secrets = pathlib.Path(tempfile.mkdtemp())
    (secrets / "qloo-test-key.local.txt").write_text("hack_0123456789abcdef0123456789abcdef\n# comment\n", encoding="utf-8")
    cases = {
        "clean": ({"README.md": "Plain words, no faults.\n"}, empty, 0),
        "qloo data": ({"data.json": '{"entity_id": "8E08D949-15FD-402E-8C39-EC8B43F6C071", "affinity": 0.9}\n'}, empty, 1),
        "samples folder": ({"samples/runs.json": "{}\n"}, empty, 1),
        "dash in readme": ({"README.md": "A brief — for stagers.\n"}, empty, 1),
        "dash in page string": ({"public/app.js": "const t = 'keep - swap'\n"}, empty, 1),
        "bare key in history": ({"notes.txt": "key hack_0123456789abcdef0123456789abcdef\n"}, secrets, 1),
    }
    failed = 0
    for name, (files, secrets_dir, want) in cases.items():
        got = run(repo(files), secrets_dir)
        ok = got == want
        failed += not ok
        print(f"{'ok  ' if ok else 'BAD '} {name}: exit {got}, want {want}")
    print("ALL CASES OK" if not failed else f"{failed} CASES WRONG")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
