from __future__ import annotations

import argparse
import collections
import json
import re
from pathlib import Path


DOC = Path(r"C:\Users\aica_\Desktop\infra_study\인사7기_프로젝트_인프라\인프라구축과정3.md")


def classify(body: str, context: str, current: str) -> str:
    current = current.lower()
    if current:
        return {"yml": "yaml", "shell": "bash", "sh": "bash"}.get(current, current)

    stripped = body.strip()
    if not stripped:
        return "text"

    lines = [line.strip() for line in stripped.splitlines() if line.strip()]
    lower = stripped.lower()
    context_lower = context.lower()

    # Structured configuration formats.
    if re.search(r"(?m)^\s*(upstream|server|location)\b[^\n{]*\{", stripped) or re.search(
        r"(?m)^\s*(listen|server_name|proxy_pass|proxy_set_header|ssl_certificate|return)\b", stripped
    ):
        return "nginx"

    if stripped.startswith(("{", "[")):
        try:
            json.loads(stripped)
            return "json"
        except json.JSONDecodeError:
            if re.search(r'"[^"\n]+"\s*:', stripped):
                return "json"

    if re.search(r"(?m)^\s*(FROM|RUN|COPY|ADD|WORKDIR|ENTRYPOINT|CMD|ARG|EXPOSE)\b", stripped):
        return "dockerfile"

    if re.search(r"(?im)^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b", stripped):
        return "sql"

    yaml_keys = re.findall(r"(?m)^\s*(?:-\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*:\s*(?:.*)$", stripped)
    yaml_markers = (
        "jobs:", "steps:", "runs-on:", "uses:", "with:", "services:",
        "permissions:", "workflow_call:", "workflow_dispatch:", "container_name:",
        "depends_on:", "networks:", "volumes:", "restart:", "healthcheck:",
    )
    if len(yaml_keys) >= 2 or any(marker in lower for marker in yaml_markers):
        return "yaml"

    # Commands written specifically for Windows PowerShell.
    if (
        "curl.exe" in lower
        or re.search(r"(?m)`\s*$", stripped)
        or re.search(r"(?im)^\s*(Get-|Set-|New-|Remove-|Resolve-DnsName|Test-NetConnection|ipconfig\b)", stripped)
        or "$env:" in stripped
    ):
        return "powershell"

    # .env examples are data files, not commands.
    env_lines = [line for line in lines if not line.startswith("#")]
    if env_lines and all(re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", line) for line in env_lines):
        if ".env" in context_lower or "환경 변수" in context or "environment variable" in context_lower:
            return "dotenv"

    bash_command = re.compile(
        r"^(?:\$\s*)?(?:sudo|aws|docker|git|chmod|chown|mkdir|curl|wget|ls|cat|nano|vi|vim|cp|mv|rm|ln|"
        r"readlink|find|systemctl|snap|nginx|openssl|journalctl|ss|grep|sed|awk|tar|unzip|zip|bash|sh|echo|"
        r"test|cd|pwd|id|command|sleep|exit|set|source|export|gh)\b"
    )
    shell_syntax = (
        stripped.startswith("#!/usr/bin/env bash")
        or bool(re.search(r"(?m)^\s*(?:if|then|elif|else|fi|for|while|do|done|case|esac)\b", stripped))
        or bool(re.search(r"(?m)^\s*[A-Za-z_][A-Za-z0-9_]*=", stripped))
        or "${" in stripped
        or "$(" in stripped
        or "[[" in stripped
    )
    command_count = sum(bool(bash_command.match(line)) for line in lines)
    if shell_syntax or command_count >= 1:
        return "bash"

    return "text"


def transform(text: str) -> tuple[str, collections.Counter, list[tuple[int, str, str]]]:
    lines = text.splitlines(keepends=True)
    out = list(lines)
    counts: collections.Counter[str] = collections.Counter()
    changes: list[tuple[int, str, str]] = []
    opener = re.compile(r"^([ \t]*)```([A-Za-z0-9_+.-]*)[ \t]*(\r?\n)?$")
    closer = re.compile(r"^[ \t]*```[ \t]*(?:\r?\n)?$")
    heading = ""
    i = 0

    while i < len(lines):
        plain = lines[i].rstrip("\r\n")
        if plain.startswith("#"):
            heading = plain

        match = opener.match(lines[i])
        if not match:
            i += 1
            continue

        current = match.group(2)
        j = i + 1
        while j < len(lines) and not closer.match(lines[j]):
            j += 1
        if j >= len(lines):
            raise RuntimeError(f"Unclosed code fence at line {i + 1}")

        body = "".join(lines[i + 1:j])
        context = heading + "\n" + "".join(lines[max(0, i - 8):i])
        language = classify(body, context, current)
        counts[language] += 1

        newline = match.group(3) or ""
        replacement = f"{match.group(1)}```{language}{newline}"
        if replacement != lines[i]:
            changes.append((i + 1, current or "(empty)", language))
            out[i] = replacement

        i = j + 1

    result = "".join(out)
    result = re.sub(r"\]\(image-(\d+)\.png\)", r"](./img/infra3-image-\1.png)", result)
    return result, counts, changes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    raw = DOC.read_bytes()
    text = raw.decode("utf-8")
    result, counts, changes = transform(text)

    print("Code block languages:", dict(sorted(counts.items())))
    print("Fence openers changed:", len(changes))
    print("Image references changed:", len(re.findall(r"\]\(image-\d+\.png\)", text)))
    print("Line count before/after:", len(text.splitlines()), len(result.splitlines()))
    print("CRLF before/after:", text.count("\r\n"), result.count("\r\n"))

    if args.apply:
        DOC.write_bytes(result.encode("utf-8"))
        print("Applied.")
    else:
        print("Dry run only.")


if __name__ == "__main__":
    main()
