#!/usr/bin/env python3
"""Copy public/ to dist/ and stamp the service worker with a content hash and
the full precache list, so every deploy invalidates the old app shell."""
import hashlib, pathlib, re, shutil, sys, json

root = pathlib.Path(__file__).resolve().parent.parent
src, dist = root / "public", root / (sys.argv[1] if len(sys.argv) > 1 else "dist")
if dist.exists():
    shutil.rmtree(dist)
shutil.copytree(src, dist)

files = sorted(p for p in dist.rglob("*") if p.is_file() and p.name != "sw.js")
h = hashlib.sha256((src / "sw.js").read_bytes())  # a change to the worker itself is a new version too
for p in files:
    h.update(str(p.relative_to(dist)).encode()); h.update(p.read_bytes())
version = h.hexdigest()[:12]
shell = ["./"] + ["./" + p.relative_to(dist).as_posix() for p in files if p.name != "index.html" and not p.name.endswith("LICENSE")]

sw = dist / "sw.js"
text = sw.read_text()
text = re.sub(r'const VERSION = ".*?";', f'const VERSION = "{version}";', text)
text = re.sub(r'const SHELL = \[.*?\];', "const SHELL = " + json.dumps(shell) + ";", text)
sw.write_text(text)

vjs = dist / "js" / "version.js"
vjs.write_text(re.sub(r'APP_VERSION = ".*?"', f'APP_VERSION = "{version}"', vjs.read_text()))
print(f"built {dist} version {version} ({len(shell)} files precached)")
