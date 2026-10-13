"""Executed inside the API image before startup; never prints connection secrets."""
import os
import sys
from urllib.parse import parse_qs, urlsplit


def main():
    import psycopg
    jdbc = os.environ["SPRING_DATASOURCE_URL"]
    if not jdbc.startswith("jdbc:postgresql://"):
        raise ValueError("PostgreSQL JDBC URL required")
    url = jdbc.removeprefix("jdbc:")
    options = parse_qs(urlsplit(url).query)
    if options.get("sslmode") != ["verify-full"]:
        raise ValueError("sslmode=verify-full required")
    if options.get("sslrootcert") != ["/app/certs/rds-ca.pem"]:
        raise ValueError("RDS CA path mismatch")
    if not urlsplit(url).hostname.endswith(".rds.amazonaws.com"):
        raise ValueError("Use the RDS endpoint")
    for label, user, password in (
        ("app", "SPRING_DATASOURCE_USERNAME", "SPRING_DATASOURCE_PASSWORD"),
        ("analysis", "ANALYSIS_DB_USERNAME", "ANALYSIS_DB_PASSWORD"),
    ):
        with psycopg.connect(url, user=os.environ[user], password=os.environ[password],
                            connect_timeout=10) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()")
                if cursor.fetchone() != (True,):
                    raise ValueError("TLS connection required")
        print(label + " RDS TLS connection OK")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Driver diagnostics can contain connection details; keep deployment logs generic.
        print("RDS login/TLS preflight failed. Check endpoint, CA, roles and parameters.", file=sys.stderr)
        sys.exit(1)
