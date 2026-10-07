"""Provision the dedicated analysis login in the already-migrated business DB.

Run explicitly with administrative PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD
and ANALYSIS_DB_USERNAME/ANALYSIS_DB_PASSWORD in the process environment.
Credentials are never command-line arguments or output. No database is created.
"""
import os
from pathlib import Path

import psycopg
from psycopg import sql


def configure(connection, username, password):
    if not username or len(password) < 24:
        raise ValueError('Dedicated username and password of at least 24 characters required')
    with connection.transaction():
        current = connection.execute('SELECT current_user').fetchone()[0]
        if username == current:
            raise ValueError('Analysis login must differ from the administrative login')
        existing = connection.execute('SELECT oid,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=%s', (username,)).fetchone()
        if existing and (any(existing[1:]) or connection.execute('SELECT EXISTS(SELECT FROM pg_auth_members WHERE member=%s)', (existing[0],)).fetchone()[0]):
            raise ValueError('Existing analysis role has administrative privileges or memberships')
        verb = 'ALTER' if existing else 'CREATE'
        connection.execute(sql.SQL(verb + ' ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD {}').format(sql.Identifier(username), sql.Literal(password)))
        grants = Path(__file__).with_name('analysis_permissions.sql').read_text(encoding='utf-8')
        connection.execute(sql.SQL(grants.replace(':"worker_role"', '{}')).format(*[sql.Identifier(username)] * grants.count(':"worker_role"')))
        if connection.execute("SELECT has_schema_privilege(%s,'private','USAGE') OR has_schema_privilege(%s,'evaluation','USAGE')", (username, username)).fetchone()[0]:
            raise ValueError('Analysis role still has protected schema access')


def main():
    try:
        with psycopg.connect(autocommit=True, connect_timeout=10) as connection:
            configure(connection, os.environ['ANALYSIS_DB_USERNAME'], os.environ['ANALYSIS_DB_PASSWORD'])
        print('Analysis database permissions configured; no credentials printed.')
    except (KeyError, ValueError, psycopg.Error):
        print('Analysis database setup failed; check target, role and credentials. Details hidden.')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
