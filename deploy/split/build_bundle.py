"""Build an explicit, secret-free split deployment bundle."""
import argparse
import hashlib
import gzip
import io
import json
from pathlib import Path
import tarfile

import image_manifest


def files(root, environment):
    base = Path(root) / "deploy/split"
    names = ["deploy.py", "check_rds.py", "image_manifest.py"]
    if environment == "dev":
        # Dev-only DB reset for new initial schemas; it refuses any database but aml_dev_v3.
        names.append("reset_dev_rds.py")
    for role in ("front", "backend"):
        relative = [f"compose.{environment}.yaml", f"deploy-{environment}.sh",
                    f"nginx/conf.d/{environment}.conf"]
        if environment == "prod":
            relative = ["compose.prod.blue.yaml", "compose.prod.green.yaml", "deploy-prod.sh",
                        "rollback-prod.sh", "nginx/conf.d/prod.conf",
                        "nginx/upstreams/prod-blue.conf", "nginx/upstreams/prod-green.conf"]
        if role == "backend" and environment == "dev":
            relative.append("inference.external.yaml")
        if role == "backend":
            relative.append("nginx/conf.d/00-default.conf")
        names.extend(f"{role}/{name}" for name in relative)
    result = [base / name for name in names]
    if any(not path.is_file() or path.is_symlink() for path in result):
        raise ValueError("A required split deployment file is missing or is a symlink.")
    return result


def build(root, environment, output, *, image_record=None, manifest_path=None):
    root, output = Path(root).resolve(), Path(output)
    manifest = None
    if image_record is not None and manifest_path is not None:
        raise ValueError("Choose one image record or manifest.")
    if image_record is not None:
        record = json.loads(Path(image_record).read_text(encoding="utf-8"))
        selected = image_manifest.from_record(record, environment=environment)
        manifest = (json.dumps(selected, sort_keys=True, indent=2) + "\n").encode()
    elif manifest_path is not None:
        selected = image_manifest.load(manifest_path, environment=environment)
        manifest = (json.dumps(selected, sort_keys=True, indent=2) + "\n").encode()
    # Stable archives allow a retry of the same Git SHA to reuse an existing release.
    with output.open("wb") as stream, gzip.GzipFile(filename="", fileobj=stream, mode="wb", mtime=0) as zipped:
        with tarfile.open(fileobj=zipped, mode="w") as archive:
            for path in files(root, environment):
                info = archive.gettarinfo(str(path), arcname=path.relative_to(root).as_posix())
                info.uid = info.gid = info.mtime = 0
                info.uname = info.gname = ""
                info.mode = 0o755 if path.suffix == ".sh" else 0o644
                with path.open("rb") as source:
                    archive.addfile(info, source)
            if manifest is not None:
                info = tarfile.TarInfo("deploy/split/images.json")
                info.size = len(manifest)
                info.mode = 0o644
                archive.addfile(info, io.BytesIO(manifest))
    return hashlib.sha256(output.read_bytes()).hexdigest()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("environment", choices=("dev", "prod"))
    parser.add_argument("output", type=Path)
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--image-record", type=Path,
                           help="Verified transfer receipt; pin images independently of the deployment commit.")
    selection.add_argument("--image-manifest", type=Path,
                           help="Validated release manifest containing the selected image digests.")
    args = parser.parse_args()
    print(build(Path(__file__).resolve().parents[2], args.environment, args.output,
                image_record=args.image_record, manifest_path=args.image_manifest))
