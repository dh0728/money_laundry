"""Run host transactions in order and compensate terminal deployment failures."""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import time


class IndeterminateCommand(RuntimeError):
    """Never issue a competing recovery command while SSM status is unknown."""


class FailedCommand(RuntimeError):
    pass


class SSM:
    def __init__(self, environment, sha, deployment_id, account, bucket, checksum, instances):
        self.environment, self.sha, self.deployment_id = environment, sha, deployment_id
        self.account, self.bucket, self.checksum = account, bucket, checksum
        self.instances = instances
        self.bootstrap = Path(__file__).with_name("receive.py").read_text(encoding="utf-8")

    def command(self, role, action):
        arguments = ["python3", "-c", self.bootstrap, self.environment, role, action, self.sha,
                     self.deployment_id, self.account, self.bucket, self.checksum]
        parameters = json.dumps({"commands": [shlex.join(arguments)], "executionTimeout": ["1200"]})
        result = subprocess.run([
            "aws", "ssm", "send-command", "--region", "ap-northeast-2",
            "--document-name", "AWS-RunShellScript", "--instance-ids", self.instances[role],
            "--timeout-seconds", "600", "--parameters", parameters,
            "--query", "Command.CommandId", "--output", "text"], capture_output=True, text=True)
        if result.returncode:
            raise IndeterminateCommand(f"SSM submission failed for {role}; check AWS before retrying.")
        command_id = result.stdout.strip()
        if not re.fullmatch(r"[a-f0-9-]{36}", command_id):
            raise IndeterminateCommand("SSM returned an invalid command ID.")
        print(f"{role} {action}: SSM {command_id}", flush=True)
        deadline = time.monotonic() + 1900
        while time.monotonic() < deadline:
            result = subprocess.run([
                "aws", "ssm", "get-command-invocation", "--region", "ap-northeast-2",
                "--command-id", command_id, "--instance-id", self.instances[role],
                "--output", "json"], capture_output=True, text=True)
            if result.returncode:
                if "InvocationDoesNotExist" not in result.stderr:
                    raise IndeterminateCommand(f"Cannot read SSM result: {command_id}")
            else:
                invocation = json.loads(result.stdout)
                status = invocation["Status"]
                if status == "Success" and invocation.get("ResponseCode") == 0:
                    return
                if status not in ("Pending", "InProgress", "Delayed", "Cancelling"):
                    # Do not print output that could contain application configuration.
                    raise FailedCommand(f"{role} {action}: {status}, command {command_id}")
            time.sleep(5)
        raise IndeterminateCommand(f"SSM result timed out; inspect command {command_id}")


def orchestrate(ssm):
    attempted = []
    try:
        for role in ("backend", "front"):
            attempted.append(role)
            ssm.command(role, "deploy")
        for role in ("backend", "front"):
            ssm.command(role, "verify")
        for role in ("front", "backend"):
            ssm.command(role, "finalize")
    except FailedCommand:
        failures = []
        for role in reversed(attempted):
            try:
                ssm.command(role, "rollback")
            except (FailedCommand, IndeterminateCommand) as error:
                failures.append(str(error))
        if failures:
            raise FailedCommand("Recovery incomplete: " + "; ".join(failures))
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("environment", choices=("dev", "prod"))
    parser.add_argument("sha")
    parser.add_argument("checksum")
    args = parser.parse_args()
    account = os.environ["AWS_ACCOUNT_ID"]
    bucket = os.environ["DEPLOY_ARTIFACT_BUCKET"]
    instances = {role: os.environ[f"{role.upper()}_EC2_INSTANCE_ID"] for role in ("front", "backend")}
    deployment_id = os.environ["SPLIT_DEPLOYMENT_ID"]
    if not (re.fullmatch(r"[0-9a-f]{40}", args.sha) and re.fullmatch(r"[0-9a-f]{64}", args.checksum)
            and re.fullmatch(r"\d{12}", account) and bucket == f"aml-deploy-artifacts-{account}"
            and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", deployment_id)
            and all(re.fullmatch(r"i-[0-9a-f]{8,17}", instance) for instance in instances.values())
            and instances["front"] != instances["backend"]):
        raise ValueError("Invalid split deployment configuration.")
    orchestrate(SSM(args.environment, args.sha, deployment_id, account, bucket, args.checksum, instances))


if __name__ == "__main__":
    try:
        main()
    except (FailedCommand, IndeterminateCommand, ValueError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
