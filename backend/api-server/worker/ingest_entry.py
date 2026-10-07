"""Private ingest entry. Source bytes arrive through stdin, never command arguments."""

import argparse
import io
import os
import sys
from uuid import UUID

import psycopg

from frozen_input import StaleExecution
from private_data import PrivateDataProtector
from report_ingest import ingest


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--upload-id',type=int,required=True)
    parser.add_argument('--execution-id',type=UUID,required=True)
    args = parser.parse_args(argv)
    if args.upload_id < 1:
        return 65
    try:
        protector = PrivateDataProtector(os.environ['INGEST_ENCRYPTION_KEY'],
            os.environ['INGEST_SEARCH_KEY'],os.environ['INGEST_KEY_VERSION'])
        with psycopg.connect(os.environ['WORKER_DB_URL'],user=os.environ.get('WORKER_DB_USER'),
                password=os.environ.get('WORKER_DB_PASSWORD'),autocommit=True,connect_timeout=10) as db:
            ingest(db,args.upload_id,args.execution_id,
                io.TextIOWrapper(sys.stdin.buffer,encoding='utf-8',errors='strict',newline=''),
                protector,os.environ.get('INGEST_ZONE','Asia/Seoul'))
        return 0
    except StaleExecution:
        return 79
    except psycopg.Error:
        return 75
    except (ValueError,KeyError,UnicodeError):
        return 65
    except OSError:
        return 74


if __name__ == '__main__':
    raise SystemExit(main())
