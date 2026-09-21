"""Single backend worker entry point, invoked by Spring for a claimed stage."""
import argparse
import os
import uuid


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-id", type=int, required=True)
    parser.add_argument("--stage", choices=("FEATURES", "INFERENCE", "SCORES", "ALERTS"), required=True)
    parser.add_argument("--execution-id", type=uuid.UUID, required=True)
    parser.add_argument("--run-id", type=uuid.UUID)
    args = parser.parse_args(argv)
    if args.job_id < 1:
        parser.error("job-id must be positive")
    if (args.stage != "FEATURES" or os.environ.get("WORKER_MODE") != "demo"
            or args.run_id is None or not os.environ.get("WORKER_DB_URL")
            or not os.environ.get("WORKER_STORAGE_DIR")):
        return 78  # Unconnected stages must never synthesize success.
    try:
        import psycopg
        from frozen_input import InputExecution, StaleExecution
        from pipeline import prepare_features
        from worker_transport import ProtocolError
    except ImportError:
        return 78
    try:
        with psycopg.connect(os.environ["WORKER_DB_URL"],
                             user=os.environ.get("WORKER_DB_USER"),
                             password=os.environ.get("WORKER_DB_PASSWORD"),
                             autocommit=True, connect_timeout=10) as connection:
            prepare_features(connection, InputExecution(args.job_id, args.run_id, args.execution_id),
                             os.environ["WORKER_STORAGE_DIR"])
        return 0
    except StaleExecution:
        return 79
    except psycopg.Error:
        return 75
    except (ProtocolError, ValueError, KeyError):
        return 65
    except OSError:
        return 74


if __name__ == "__main__":
    raise SystemExit(main())
