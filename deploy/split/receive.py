"""SSM bootstrap: download, verify and extract the immutable deployment bundle."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import tempfile


def extract(archive, destination):
    with tarfile.open(archive, "r:gz") as bundle:
        seen = set()
        for member in bundle.getmembers():
            path = PurePosixPath(member.name)
            if (not member.isfile() or member.name in seen or path.is_absolute()
                    or ".." in path.parts or path.parts[:2] != ("deploy", "split")
                    or member.size > 2_000_000):
                raise ValueError("Unexpected deployment archive member.")
            seen.add(member.name)
        bundle.extractall(destination, filter="data")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("environment", choices=("dev", "prod"))
    parser.add_argument("role", choices=("backend", "front"))
    parser.add_argument("action", choices=("deploy", "verify", "finalize", "rollback"))
    parser.add_argument("sha")
    parser.add_argument("deployment_id")
    parser.add_argument("account")
    parser.add_argument("bucket")
    parser.add_argument("checksum")
    args = parser.parse_args()
    if not (re.fullmatch(r"[0-9a-f]{40}", args.sha)
            and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", args.deployment_id)
            and re.fullmatch(r"\d{12}", args.account)
            and args.bucket == f"aml-deploy-artifacts-{args.account}"
            and re.fullmatch(r"[0-9a-f]{64}", args.checksum)):
        raise ValueError("Invalid deployment inputs.")
    root = Path("/opt/aml")
    config = json.loads((root / "shared/split.json").read_text(encoding="utf-8"))
    if (config.get("layout"), config.get("role"), config.get("account_id")) != ("split", args.role, args.account):
        raise ValueError("Target host is not configured for this split deployment.")
    history = root / f"state/split/history/{args.environment}-{args.deployment_id}.json"
    if args.action == "rollback" and not history.exists():
        print("No host changes to roll back.")
        return
    parent = root / "releases" / args.environment
    parent.mkdir(parents=True, exist_ok=True)
    release = parent / args.sha
    if args.action == "deploy" and not release.exists():
        with tempfile.TemporaryDirectory(prefix=".incoming-", dir=parent) as temporary:
            incoming = Path(temporary)
            archive = incoming / "bundle.tar.gz"
            subprocess.run(["aws", "s3", "cp",
                            f"s3://{args.bucket}/releases/{args.environment}/{args.sha}/deploy-bundle.tar.gz",
                            str(archive), "--region", "ap-northeast-2", "--only-show-errors"], check=True)
            if hashlib.sha256(archive.read_bytes()).hexdigest() != args.checksum:
                raise ValueError("Deployment bundle checksum mismatch.")
            staging = incoming / "release"
            staging.mkdir()
            extract(archive, staging)
            (staging / ".bundle.sha256").write_text(args.checksum, encoding="utf-8")
            try:
                os.rename(staging, release)
            except FileExistsError:
                pass
    if not release.is_dir() or (release / ".bundle.sha256").read_text(encoding="utf-8") != args.checksum:
        raise ValueError("Release does not match the requested bundle.")
    command = ["python3", str(release / "deploy/split/deploy.py"),
               "--role", args.role, "--environment", args.environment,
               "--account-id", args.account, "--action", args.action,
               "--deployment-id", args.deployment_id]
    if args.action == "deploy":
        command += ["--sha", args.sha]
    subprocess.run(command, check=True)


if __name__ == "__main__":
    main()
