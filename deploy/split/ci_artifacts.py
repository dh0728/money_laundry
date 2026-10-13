"""Verify production pins and publish a bundle without replacing a release key."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

import image_manifest


class AWSError(RuntimeError):
    def __init__(self, operation, code):
        self.code = code
        super().__init__(f"AWS {operation} failed ({code}); inspect permissions and retry after review.")


def aws(*arguments):
    result = subprocess.run(
        ["aws", *arguments, "--region", "ap-northeast-2", "--output", "json", "--no-cli-pager"],
        capture_output=True, text=True, check=False,
    )
    if result.returncode:
        match = re.search(r"An error occurred \(([A-Za-z0-9]+)\)", result.stderr)
        raise AWSError(" ".join(arguments[:2]), match[1] if match else "CLIError")
    return json.loads(result.stdout) if result.stdout.strip() else {}


def verify_production(manifest_path, account):
    manifest = image_manifest.load(manifest_path, environment="prod", account=account)
    for service, reference in manifest["images"].items():
        digest = reference.split("@", 1)[1]
        result = aws("ecr", "describe-images", "--registry-id", account,
                     "--repository-name", f"aml-{service}", "--image-ids", f"imageDigest={digest}")
        details = result.get("imageDetails", [])
        if len(details) != 1 or details[0].get("imageDigest") != digest:
            raise ValueError(f"Production {service} digest was not verified in ECR.")
    return manifest


def publish(bundle, *, environment, sha, account, bucket):
    if (environment not in ("dev", "prod") or not re.fullmatch(r"[0-9a-f]{40}", sha)
            or not re.fullmatch(r"[0-9]{12}", account)
            or bucket != f"aml-deploy-artifacts-{account}"):
        raise ValueError("Invalid bundle destination.")
    bundle = Path(bundle)
    if bundle.is_symlink() or not bundle.is_file() or not 0 < bundle.stat().st_size <= 20_000_000:
        raise ValueError("Invalid deployment bundle file.")
    digest = hashlib.sha256(bundle.read_bytes()).digest()
    checksum = digest.hex()
    key = f"releases/{environment}/{sha}/deploy-bundle.tar.gz"
    try:
        aws("s3api", "put-object", "--bucket", bucket, "--key", key,
            "--body", str(bundle), "--if-none-match", "*",
            "--server-side-encryption", "AES256", "--expected-bucket-owner", account,
            "--checksum-sha256", base64.b64encode(digest).decode("ascii"))
    except AWSError as error:
        if error.code != "PreconditionFailed":
            raise
        # Only an identical previous upload may be reused. No unconditional PUT fallback.
    with tempfile.TemporaryDirectory(prefix="aml-bundle-readback-") as directory:
        downloaded = Path(directory) / "bundle.tar.gz"
        aws("s3api", "get-object", "--bucket", bucket, "--key", key,
            "--expected-bucket-owner", account, str(downloaded))
        if hashlib.sha256(downloaded.read_bytes()).hexdigest() != checksum:
            raise ValueError("Release key already contains different bytes; use a new deployment commit.")
    return checksum


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    verify = commands.add_parser("verify-prod")
    verify.add_argument("manifest", type=Path)
    verify.add_argument("account")
    upload = commands.add_parser("publish")
    upload.add_argument("bundle", type=Path)
    upload.add_argument("environment", choices=("dev", "prod"))
    upload.add_argument("sha")
    upload.add_argument("account")
    upload.add_argument("bucket")
    args = parser.parse_args()
    if args.command == "verify-prod":
        print(verify_production(args.manifest, args.account)["app_sha"])
    else:
        print(publish(args.bundle, environment=args.environment, sha=args.sha,
                      account=args.account, bucket=args.bucket))


if __name__ == "__main__":
    main()
