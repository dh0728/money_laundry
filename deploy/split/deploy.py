#!/usr/bin/env python3
"""Host-local deployment for the two-EC2 layout. Only the standard library is used."""
import argparse
import base64
import contextlib
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import ssl
import hashlib
from urllib.parse import urlsplit
import subprocess
import sys
import tempfile
import time

import image_manifest


class DeploymentError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise DeploymentError(message)


def atomic_json(path, value):
    atomic_file(path, (json.dumps(value, indent=2) + "\n").encode(), 0o600)


def atomic_file(path, data, mode=0o644):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".aml-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def read_json(path, default=None):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


class Runner:
    def run(self, command, *, env=None, data=None):
        result = subprocess.run(command, env=env, input=data, text=True, capture_output=True)
        if result.returncode:
            # Do not expose container environment, DB credentials, or AWS parameter values.
            raise DeploymentError("Command failed: " + " ".join(command[:3]))
        return result.stdout.strip()


class Deployment:
    def __init__(self, role, environment, account, *, root=Path("/opt/aml"),
                 nginx=Path("/etc/nginx"), runner=None):
        self.role, self.environment, self.account = role, environment, account
        self.root, self.nginx = Path(root), Path(nginx)
        self.runner = runner or Runner()
        self.state_dir = self.root / "state/split"
        self.state_file = self.state_dir / f"{environment}.json"
        self.pending_file = self.state_dir / f"{environment}-pending.json"
        self.config = read_json(self.root / "shared/split.json", {})
        require(self.config.get("layout") == "split" and self.config.get("role") == role,
                "Configure /opt/aml/shared/split.json for this host role first.")
        require(self.config.get("account_id") == account and re.fullmatch(r"\d{12}", account),
                "Host account does not match the requested migration account.")
        self.region = self.config.get("region", "ap-northeast-2")
        require(self.region == "ap-northeast-2", "Expected Seoul region.")
        self.parameters = None
        self.inference_tokens = {}

    @contextlib.contextmanager
    def lock(self):
        import fcntl
        self.state_dir.mkdir(parents=True, exist_ok=True)
        # Both environments edit the same nginx configuration, so use one host lock.
        with (self.state_dir / "host.lock").open("a") as stream:
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise DeploymentError("Another split deployment is running.") from error
            yield

    def authenticate(self):
        actual = self.runner.run(["aws", "sts", "get-caller-identity", "--region", self.region,
                                  "--query", "Account", "--output", "text"])
        require(actual == self.account, "EC2 credentials belong to a different AWS account.")
        password = self.runner.run(["aws", "ecr", "get-login-password", "--region", self.region])
        self.runner.run(["docker", "login", "--username", "AWS", "--password-stdin",
                         self.registry], data=password)

    @property
    def registry(self):
        return f"{self.account}.dkr.ecr.{self.region}.amazonaws.com"

    def parameter(self, suffix):
        value = json.loads(self.runner.run([
            "aws", "ssm", "get-parameter", "--region", self.region, "--with-decryption",
            "--name", f"/aml/{self.environment}/{suffix}", "--query", "Parameter.Value",
            "--output", "json"]))
        # JSON decoding preserves whitespace and special characters in the actual secret.
        require(isinstance(value, str) and bool(value), f"Missing parameter: {suffix}")
        return value

    def dev_inference(self):
        target = self.config.get("dev_inference_target", "local")
        require(target in ("local", "kubesphere", "naver"), "Invalid dev_inference_target.")
        if target == "local":
            return {"target": "local"}
        ca = self.root / "certs/inference" / target / "ca.crt"
        require(ca.is_file(), "Install the selected inference public CA first.")
        selection = {"target": target, "url": self.parameter(f"inference/{target}/url"),
                     "ca_file": str(ca), "ca_sha256": hashlib.sha256(ca.read_bytes()).hexdigest()}
        self.validate_inference(selection)
        return selection

    def validate_inference(self, selection):
        require(isinstance(selection, dict), "Invalid inference selection.")
        target = selection.get("target")
        require(target in ("local", "kubesphere", "naver"), "Invalid inference target.")
        if target == "local":
            require(selection == {"target": "local"}, "Invalid local inference selection.")
            return
        try:
            raw_url = selection["url"]
            url = urlsplit(raw_url)
            valid = (url.scheme == "https" and url.hostname and not url.username
                     and not url.password and not url.query and not url.fragment
                     and url.path in ("", "/") and (url.port is None or 1 <= url.port <= 65535)
                     and not any(c.isspace() or ord(c) < 32 for c in raw_url))
            require(valid, "External inference requires an HTTPS origin URL.")
            require(url.hostname not in ("localhost", "127.0.0.1", "::1"),
                    "External inference cannot use loopback.")
            ca = self.root / "certs/inference" / target / "ca.crt"
            require(selection["ca_file"] == str(ca), "Unexpected inference CA path.")
            require(hashlib.sha256(ca.read_bytes()).hexdigest() == selection["ca_sha256"],
                    "Inference CA changed; review and deploy a new selection.")
            ssl.create_default_context(cafile=str(ca))
        except (KeyError, OSError, ValueError, ssl.SSLError):
            raise DeploymentError("Invalid inference URL or CA configuration.") from None

    def inference_environment(self, selection):
        self.validate_inference(selection)
        target = selection["target"]
        local_token = self.parameters["DEV_LOCAL_INFERENCE_TOKEN"]
        if target == "local":
            return dict(DEV_INFERENCE_API_URL="http://127.0.0.1:8090",
                        DEV_INFERENCE_API_TOKEN=local_token, DEV_INFERENCE_ALLOW_LOOPBACK="true",
                        DEV_INFERENCE_CA_FILE="", DEV_INFERENCE_CA_HOST_FILE="")
        if target not in self.inference_tokens:
            # Check the type without ever serializing the decrypted token into deployment state.
            token_path = "inference/token" if target == "kubesphere" else f"inference/{target}/token"
            parameter = json.loads(self.runner.run([
                "aws", "ssm", "get-parameter", "--region", self.region, "--with-decryption",
                "--name", f"/aml/dev/{token_path}", "--query", "Parameter", "--output", "json"]))
            require(parameter.get("Type") == "SecureString", "Inference token must be SecureString.")
            token = parameter.get("Value", "")
            require(isinstance(token, str) and len(token) >= 32
                    and all(32 < ord(c) < 127 for c in token), "Invalid inference token.")
            self.inference_tokens[target] = token
        if target == "kubesphere":
            # Reuse the existing dev credential; keep both consumers on the same fetched value.
            local_token = self.inference_tokens[target]
            self.parameters["DEV_LOCAL_INFERENCE_TOKEN"] = local_token
        return dict(DEV_INFERENCE_API_URL=selection["url"].rstrip("/"),
                    DEV_INFERENCE_API_TOKEN=self.inference_tokens[target],
                    DEV_LOCAL_INFERENCE_TOKEN=local_token,
                    DEV_INFERENCE_ALLOW_LOOPBACK="false",
                    DEV_INFERENCE_CA_FILE="/app/certs/inference-ca.crt",
                    DEV_INFERENCE_CA_HOST_FILE=selection["ca_file"])

    def runtime(self, sha, *, inference=None):
        prefix = self.environment.upper()
        values = dict(os.environ, AWS_REGION=self.region, AWS_DEFAULT_REGION=self.region)
        service = "WEB" if self.role == "front" else "API"
        values[f"{prefix}_{service}_IMAGE"] = self.image_reference(sha)
        if self.role == "backend":
            if self.parameters is None:
                mapping = {
                    "DB_URL": "db/url", "POSTGRES_USER": "db/username",
                    "POSTGRES_PASSWORD": "db/password", "S3_BUCKET": "s3/bucket",
                    "S3_PREFIX": "s3/prefix", "INGEST_ENCRYPTION_KEY": "ingest/encryption-key",
                    "INGEST_SEARCH_KEY": "ingest/search-key", "INGEST_KEY_VERSION": "ingest/key-version",
                    "ANALYSIS_DB_USERNAME": "analysis-db/username",
                    "ANALYSIS_DB_PASSWORD": "analysis-db/password",
                }
                self.parameters = {f"{prefix}_{key}": self.parameter(path) for key, path in mapping.items()}
                if self.environment == "dev":
                    self.parameters["DEV_LOCAL_INFERENCE_TOKEN"] = self.parameter("inference/token")
                    bucket = self.parameters["DEV_S3_BUCKET"]
                    key = self.parameters["DEV_S3_PREFIX"].rstrip("/")
                    self.parameters["DEV_INFERENCE_OBJECT_BASE_URL"] = f"https://{bucket}.s3.{self.region}.amazonaws.com/{key}/"
                else:
                    presentation = self.parameter("presentation/enabled")
                    require(presentation in ("true", "false"), "Invalid presentation/enabled.")
                    mode = self.config.get("prod_worker_mode")
                    require(mode in ("demo", "unconfigured"), "Set prod_worker_mode explicitly.")
                    self.parameters.update(PROD_PRESENTATION_ENABLED=presentation, PROD_WORKER_MODE=mode,
                                           PROD_INFERENCE_API_URL="", PROD_INFERENCE_API_TOKEN="")
                    if mode == "demo":
                        url = self.config.get("prod_inference_url", "")
                        require(url.startswith("https://"), "Production inference requires an HTTPS URL.")
                        self.parameters.update(PROD_INFERENCE_API_URL=url,
                                               PROD_INFERENCE_API_TOKEN=self.parameter("inference/token"))
            values.update(self.parameters)
            if self.environment == "dev":
                values.update(self.inference_environment(
                    self.dev_inference() if inference is None else inference))
        return values

    def image_reference(self, sha):
        service = "web" if self.role == "front" else "api"
        path = self.release({"sha": sha}) / "deploy/split/images.json"
        if path.exists() or path.is_symlink():
            manifest = image_manifest.load(path, environment=self.environment, account=self.account)
            return manifest["images"][service]
        # Older bundles and normal CI releases continue to use their commit tag.
        return f"{self.registry}/aml-{service}:{self.environment}-{sha}"

    def release(self, meta):
        require(re.fullmatch(r"[0-9a-f]{40}", meta["sha"]), "Invalid release SHA.")
        return self.root / "releases" / self.environment / meta["sha"]

    def compose(self, meta, *arguments, data=None):
        color = meta["color"]
        require(color in ("dev", "blue", "green"), "Invalid deployment color.")
        filename = "compose.dev.yaml" if self.environment == "dev" else f"compose.prod.{color}.yaml"
        path = self.release(meta) / "deploy/split" / self.role / filename
        require(path.is_file(), "Release Compose file is missing.")
        selection = None
        overlays = []
        if self.role == "backend" and self.environment == "dev":
            # Releases made before target selection always used the local server.
            selection = meta.get("inference", {"target": "local"})
            if selection["target"] != "local":
                overlay = path.with_name("inference.external.yaml")
                require(overlay.is_file(), "External inference Compose overlay is missing.")
                overlays = ["-f", str(overlay)]
        return self.runner.run(["docker", "compose", "--env-file", "/dev/null", "-f", str(path),
                                *overlays, *arguments],
                               env=self.runtime(meta["sha"], inference=selection), data=data)

    def state(self):
        return read_json(self.state_file, {"current": None, "previous": None})

    def other_environment(self):
        return "prod" if self.environment == "dev" else "dev"

    def require_other_idle(self):
        require(not (self.state_dir / f"{self.other_environment()}-pending.json").exists(),
                "Recover or finish the other environment's pending deployment first.")

    def check_http(self, url, *, api, headers=(), retry=False):
        command = ["curl", "--disable", "-fsS", "--noproxy", "*",
                   "--connect-timeout", "3", "--max-time", "10",
                   "--write-out", "\n%{http_code}"]
        if retry:
            command += ["--retry", "5", "--retry-delay", "2", "--retry-all-errors"]
        for header in headers:
            command += ["-H", header]
        result = self.runner.run([*command, url])
        body, separator, status = result.rpartition("\n")
        require(separator and status == "200", "Health endpoint did not return HTTP 200.")
        if api:
            try:
                response = json.loads(body)
            except ValueError as error:
                raise DeploymentError("API health response is not JSON.") from error
            require(isinstance(response, dict) and response.get("status") == "UP",
                    "API health response is not UP.")
        else:
            require(body.strip() == "ok", "Web health response is not ok.")

    def health(self, meta, *, proxy=False, include_backend=True):
        if proxy:
            domain = "dev.aiaml.co.kr" if self.environment == "dev" else "aiaml.co.kr"
            urls = [("/api/actuator/health", True)] if self.role == "backend" or include_backend else []
            if self.role == "front":
                urls.insert(0, ("/health", False))
            for path, api in urls:
                # Reload sends a signal; old nginx workers may still answer briefly.
                self.check_http("http://127.0.0.1" + path, api=api,
                                headers=[f"Host: {domain}"], retry=True)
        else:
            port = {"dev": 3001, "blue": 3000, "green": 3002}[meta["color"]]
            path = "/health"
            if self.role == "backend":
                port = {"dev": 8081, "blue": 8080, "green": 8082}[meta["color"]]
                path = "/actuator/health"
            self.check_http(f"http://127.0.0.1:{port}{path}", api=self.role == "backend", retry=True)

    def managed_paths(self):
        paths = [self.nginx / f"conf.d/aml-{self.environment}.conf",
                 self.root / f"current-{self.environment}"]
        if self.role == "backend":
            paths += [self.nginx / "conf.d/aml-default.conf", self.nginx / "sites-enabled/default"]
        if self.environment == "prod":
            paths += [self.nginx / "upstreams" / name for name in
                      ("prod-blue.conf", "prod-green.conf", "prod-active.conf")]
        return paths

    def snapshot(self):
        result = []
        for path in self.managed_paths():
            item = {"path": str(path), "kind": "absent"}
            if path.is_symlink():
                item.update(kind="link", target=os.readlink(path))
            elif path.exists():
                require(path.is_file(), "Managed path is not a file.")
                item.update(kind="file", data=base64.b64encode(path.read_bytes()).decode(),
                            mode=path.stat().st_mode & 0o777)
            result.append(item)
        return result

    def restore_files(self, snapshot):
        allowed = {str(path) for path in self.managed_paths()}
        other = read_json(self.state_dir / f"{self.other_environment()}.json", {})
        shared = {str(self.nginx / "conf.d/aml-default.conf"),
                  str(self.nginx / "sites-enabled/default")}
        for item in snapshot:
            require(item["path"] in allowed, "Unexpected recovery path.")
            # Another environment may have been deployed since this snapshot was taken.
            # Keep its shared default virtual host in place during an older rollback.
            if self.role == "backend" and other.get("current") and item["path"] in shared:
                continue
            path = Path(item["path"])
            if item["kind"] == "file":
                atomic_file(path, base64.b64decode(item["data"]), item["mode"])
            else:
                path.unlink(missing_ok=True)
                if item["kind"] == "link":
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.symlink_to(item["target"])

    def configure_nginx(self, meta):
        source = self.release(meta) / "deploy/split" / self.role / "nginx"
        config = (source / f"conf.d/{self.environment}.conf").read_text(encoding="utf-8")
        if self.role == "front":
            address = ipaddress.IPv4Address(self.config.get("backend_private_ip", ""))
            require(address.is_private and not address.is_loopback and not address.is_unspecified,
                    "Set backend_private_ip to the backend's private IPv4.")
            config = config.replace("<BACKEND_PRIVATE_IP>", str(address))
        else:
            atomic_file(self.nginx / "conf.d/aml-default.conf",
                        (source / "conf.d/00-default.conf").read_bytes())
            (self.nginx / "sites-enabled/default").unlink(missing_ok=True)
        atomic_file(self.nginx / f"conf.d/aml-{self.environment}.conf", config.encode())
        if self.environment == "prod":
            for color in ("blue", "green"):
                atomic_file(self.nginx / f"upstreams/prod-{color}.conf",
                            (source / f"upstreams/prod-{color}.conf").read_bytes())
            self.link(self.nginx / "upstreams/prod-active.conf",
                      self.nginx / f"upstreams/prod-{meta['color']}.conf")
        self.reload()

    @staticmethod
    def link(path, target):
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(path.name + ".split-next")
        temporary.unlink(missing_ok=True)
        temporary.symlink_to(target)
        os.replace(temporary, path)

    def reload(self):
        self.runner.run(["nginx", "-t"])
        self.runner.run(["systemctl", "reload", "nginx"])

    def journal_path(self, deployment_id):
        require(re.fullmatch(r"[A-Za-z0-9_-]{1,80}", deployment_id), "Invalid deployment ID.")
        return self.state_dir / "history" / f"{self.environment}-{deployment_id}.json"

    def check_rds(self, meta):
        checker = self.release(meta) / "deploy/split/check_rds.py"
        extra = []
        if self.environment == "dev":
            previous = self.state().get("current") or {}
            old = previous.get("inference", {"target": "local"})
            new = meta.get("inference", {"target": "local"})
            if (old.get("target"), old.get("url")) != (new.get("target"), new.get("url")):
                extra = ["-e", "AML_REQUIRE_INFERENCE_IDLE=true"]
        self.compose(meta, "run", "--rm", "--no-deps", "-T", *extra, "--entrypoint",
                     "/usr/local/bin/python", "api", "-", data=checker.read_text(encoding="utf-8"))

    def deploy(self, sha, deployment_id):
        self.require_other_idle()
        journal_path = self.journal_path(deployment_id)
        before = self.state()
        pending = read_json(self.pending_file)
        if pending:
            require(pending["id"] == deployment_id and before["current"]
                    and before["current"]["transaction"] == deployment_id
                    and before["current"]["sha"] == sha, "Recover the pending transaction first.")
            self.health(before["current"], proxy=True)
            return
        require(not journal_path.exists(), "Deployment ID already used; choose a new ID.")
        color = "dev" if self.environment == "dev" else (
            "green" if before["current"] and before["current"]["color"] == "blue" else "blue")
        target = {"sha": sha, "color": color, "transaction": deployment_id}
        if self.role == "backend" and self.environment == "dev":
            target["inference"] = self.dev_inference()
        self.image_reference(sha)
        self.authenticate()
        self.compose(target, "config", "--quiet")
        self.compose(target, "pull")
        if self.role == "backend":
            self.check_rds(target)
        journal = {"id": deployment_id, "target": target, "before": before,
                   "files": self.snapshot(), "status": "starting", "started": False,
                   "nginx_touched": False}
        atomic_json(journal_path, journal)
        atomic_json(self.pending_file, {"id": deployment_id})
        try:
            journal["started"] = True
            atomic_json(journal_path, journal)
            self.compose(target, "up", "-d", "--no-build", "--pull", "never",
                         "--wait", "--wait-timeout", "300")
            self.health(target)
            journal["nginx_touched"] = True
            atomic_json(journal_path, journal)
            self.configure_nginx(target)
            self.health(target, proxy=True)
            self.link(self.root / f"current-{self.environment}", self.release(target))
            atomic_json(self.state_file, {"current": target, "previous": before["current"]})
            journal["status"] = "ready"
            atomic_json(journal_path, journal)
        except BaseException:
            # A journal remains on disk if recovery itself fails.
            self.rollback(deployment_id, automatic=True)
            raise

    def rollback(self, deployment_id, *, automatic=False):
        path = self.journal_path(deployment_id)
        journal = read_json(path)
        # Preflight failures cause no host mutations and have no journal.
        if journal is None or journal["status"] == "rolled-back":
            return
        self.require_other_idle()
        pending = read_json(self.pending_file)
        current = self.state()["current"]
        require((pending["id"] == deployment_id) if pending else
                (current and current["transaction"] == deployment_id),
                "Refusing to roll back a newer deployment.")
        previous = journal["before"]["current"]
        if previous:
            if not automatic:
                self.authenticate()
            self.compose(previous, "up", "-d", "--no-build", "--pull", "never",
                         "--wait", "--wait-timeout", "300")
            self.health(previous)
        if journal["nginx_touched"]:
            self.restore_files(journal["files"])
            self.reload()
            if previous:
                # Front rolls back before backend; an unhealthy backend must not prevent
                # restoring the front's own web and nginx state. Backend verifies its API.
                self.health(previous, proxy=True, include_backend=False)
        # Dev uses one project, so restoring the old project already replaces the failed one.
        if journal["started"] and (self.environment == "prod" or not previous):
            self.compose(journal["target"], "stop", "--timeout", "40")
        atomic_json(self.state_file, journal["before"])
        journal["status"] = "rolled-back"
        atomic_json(path, journal)
        self.pending_file.unlink(missing_ok=True)

    def verify(self, deployment_id):
        current = self.state()["current"]
        require(current and current["transaction"] == deployment_id, "Release state does not match.")
        self.health(current)
        self.health(current, proxy=True)

    def finalize(self, deployment_id):
        self.verify(deployment_id)
        path = self.journal_path(deployment_id)
        journal = read_json(path)
        require(journal and journal["status"] in ("ready", "finalized"), "Release not ready.")
        previous = journal["before"]["current"]
        if previous and self.environment == "prod":
            seconds = int(self.config.get("drain_seconds", 30))
            require(0 <= seconds <= 300, "Invalid drain_seconds.")
            time.sleep(seconds)
            self.compose(previous, "stop", "--timeout", "40")
        self.verify(deployment_id)
        journal["status"] = "finalized"
        atomic_json(path, journal)
        self.pending_file.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--role", choices=("front", "backend"), required=True)
    parser.add_argument("--environment", choices=("dev", "prod"), required=True)
    parser.add_argument("--account-id", required=True)
    parser.add_argument("--action", choices=("deploy", "verify", "finalize", "rollback"), required=True)
    parser.add_argument("--deployment-id", required=True)
    parser.add_argument("--sha")
    args = parser.parse_args()
    require(os.geteuid() == 0, "Run with sudo/root on the target EC2.")
    engine = Deployment(args.role, args.environment, args.account_id)
    if args.action == "deploy":
        require(args.sha and re.fullmatch(r"[0-9a-f]{40}", args.sha), "Full Git SHA required.")
        require(Path(__file__).resolve().parents[2] == engine.release({"sha": args.sha}),
                "Run the script from its extracted /opt/aml/releases/<env>/<sha> directory.")
    def interrupted(signum, frame):
        raise DeploymentError(f"Interrupted by signal {signum}.")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    with engine.lock():
        if args.action == "deploy":
            engine.deploy(args.sha, args.deployment_id)
        else:
            getattr(engine, args.action)(args.deployment_id)
    print(f"{args.role} {args.environment} {args.action}: OK")


if __name__ == "__main__":
    try:
        main()
    except (DeploymentError, OSError, ValueError, KeyError) as error:
        print(f"Deployment failed: {error}", file=sys.stderr)
        sys.exit(1)
