"""Build a source-only Vercel Drop archive without local secrets or records."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
target = root.parent / "maker-ton-vercel.zip"
trees = ("app",)
files = ("package.json", "package-lock.json", "vite.config.js", "vercel.json", ".vercelignore")


def permitted(path):
    relative = path.relative_to(root)
    return (not path.is_symlink() and path.is_file()
            and not any(part.startswith(".") or part in ("node_modules", "data", "__pycache__")
                        for part in relative.parts)
            and not any(path.name.endswith(suffix) for suffix in (".db", ".sqlite", ".sqlite-wal", ".sqlite-shm", ".pyc")))


with ZipFile(target, "w", ZIP_DEFLATED) as archive:
    for name in files:
        path = root / name
        if path.is_symlink() or not path.is_file():
            raise RuntimeError(f"Required source file unavailable: {name}")
        archive.write(path, name)
    for directory in trees:
        for path in sorted((root / directory).rglob("*")):
            if permitted(path):
                archive.write(path, path.relative_to(root).as_posix())

with ZipFile(target) as archive:
    print(f"Created {target.name}: {len(archive.namelist())} source files; no runtime .env or database files.")
