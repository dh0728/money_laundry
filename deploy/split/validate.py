"""Validate without Docker daemon access, AWS calls, or real parameter values."""
import ast
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import textwrap


def validate_inference_mount(volumes, overlay_source):
    # Older Compose omits false from JSON. Keep an explicit source guard as newer
    # versions may instead omit the default true value from normalized output.
    assert re.search(r"(?m)^\s+create_host_path:[ \t]+false[ \t]*(?:#.*)?$", overlay_source), \
        "Inference overlay must explicitly disable host path creation"
    assert any(v.get("type") == "bind"
               and v.get("target") == "/app/certs/inference-ca.crt"
               and v.get("read_only") is True
               and v.get("bind", {}).get("create_host_path", False) is False
               for v in volumes), "Inference CA must be a read-only bind without host path creation"


def main():
    root = Path(__file__).resolve().parent
    bash = shutil.which("bash")
    if not bash:
        raise RuntimeError("Bash is required for syntax checks.")
    for path in root.rglob("*.py"):
        ast.parse(path.read_text(encoding="utf-8"))
    for path in root.rglob("*.sh"):
        subprocess.run([bash, "--noprofile", "--norc", "-n", path.as_posix()], check=True)
    workflow = root.parents[1] / ".github/workflows/deploy-split.yml"
    with tempfile.TemporaryDirectory(prefix="aml-split-validation-") as temporary:
        folder = Path(temporary)
        empty = folder / "empty.env"
        empty.write_text("", encoding="utf-8")
        for path in sorted(root.glob("*/compose*.yaml")):
            source = path.read_text(encoding="utf-8")
            env = dict(os.environ)
            for match in re.finditer(r"\$\{([A-Z][A-Z0-9_]*)(?:(:-|:\?)([^}]*))?\}", source):
                name, operation, default = match.groups()
                env[name] = default if operation == ":-" else "test-only"
                if name.endswith("_IMAGE"):
                    env[name] = "example.invalid/aml:validation"
            result = subprocess.run(["docker", "compose", "--env-file", str(empty), "-f",
                                     str(path), "config", "--format", "json"],
                                    env=env, cwd=folder, capture_output=True, text=True, check=True)
            config = json.loads(result.stdout)
            services = config["services"]
            expected = {"web"} if path.parent.name == "front" else (
                {"api", "inference"} if path.name == "compose.dev.yaml" else {"api"})
            assert set(services) == expected, path
            if "api" in services:
                api = services["api"]
                assert "JWT_SECRET" not in api["environment"] and "SQS_QUEUE_URL" not in api["environment"]
                assert not api.get("depends_on")
                assert any(v["target"] == "/app/certs/rds-ca.pem" and v["read_only"]
                           for v in api["volumes"])
            for service in services.values():
                for port in service.get("ports", []):
                    assert port["host_ip"] == "127.0.0.1", path
        # External override must mount only the public CA into the API; local server keeps its own token.
        external_env = dict(os.environ)
        base = root / "backend/compose.dev.yaml"
        for name in re.findall(r"\$\{([A-Z][A-Z0-9_]*)", base.read_text(encoding="utf-8")):
            external_env[name] = "test-only"
        external_env.update(DEV_API_IMAGE="example.invalid/aml:validation", DEV_API_PORT="8081",
                            AWS_REGION="ap-northeast-2", DEV_INFERENCE_API_URL="https://gpu.example:31575",
                            DEV_INFERENCE_ALLOW_LOOPBACK="false", DEV_INFERENCE_CA_FILE="/app/certs/inference-ca.crt",
                            DEV_INFERENCE_CA_HOST_FILE="/opt/aml/certs/inference/kubesphere/ca.crt",
                            DEV_INFERENCE_API_TOKEN="remote-test-token", DEV_LOCAL_INFERENCE_TOKEN="local-test-token")
        result = subprocess.run(["docker", "compose", "--env-file", str(empty), "-f", str(base),
                                 "-f", str(root / "backend/inference.external.yaml"), "config", "--format", "json"],
                                env=external_env, cwd=folder, capture_output=True, text=True, check=True)
        services = json.loads(result.stdout)["services"]
        api = services["api"]
        assert api["environment"]["INFERENCE_API_URL"] == "https://gpu.example:31575"
        assert api["environment"]["INFERENCE_ALLOW_LOOPBACK"] == "false"
        assert api["environment"]["INFERENCE_API_TOKEN"] == "remote-test-token"
        assert services["inference"]["environment"]["INFERENCE_TOKEN"] == "local-test-token"
        validate_inference_mount(api["volumes"],
                                 (root / "backend/inference.external.yaml").read_text(encoding="utf-8"))
        # Check every shell block without evaluating GitHub expressions or executing it.
        source = workflow.read_text(encoding="utf-8")
        for index, match in enumerate(re.finditer(r"(?m)^(\s*)run: \|\n", source)):
            indent = len(match[1])
            lines = []
            for line in source[match.end():].splitlines():
                if line.strip() and len(line) - len(line.lstrip()) <= indent:
                    break
                lines.append(line)
            script = folder / f"workflow-{index}.sh"
            script.write_text(textwrap.dedent("\n".join(lines)) + "\n", encoding="utf-8", newline="\n")
            subprocess.run([bash, "--noprofile", "--norc", "-n", script.as_posix()], check=True)
    print("Split configuration: 6 Compose files + external dev overlay, Python and Bash syntax OK. No AWS or containers used.")


if __name__ == "__main__":
    main()
