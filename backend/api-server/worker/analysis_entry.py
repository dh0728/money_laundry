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
    parser.add_argument("--operation", choices=("PUBLISH",))
    parser.add_argument("--model-kind", choices=("BINARY", "TYPE"))
    args = parser.parse_args(argv)
    if args.job_id < 1:
        parser.error("job-id must be positive")
    publishing = args.stage == "INFERENCE" and args.operation == "PUBLISH" and args.model_kind is not None
    preparing = args.stage == "FEATURES" and args.operation is None and args.model_kind is None
    if (not (preparing or publishing) or os.environ.get("WORKER_MODE") != "demo"
            or args.run_id is None or not os.environ.get("WORKER_DB_URL")
            or not os.environ.get("WORKER_STORAGE_DIR")):
        return 78  # Unconnected stages must never synthesize success.
    try:
        import psycopg
        import httpx
        from botocore.exceptions import BotoCoreError, ClientError
        from frozen_input import InputExecution, StaleExecution
        from pipeline import prepare_features
        from worker_transport import ProtocolError, StoreUnavailable
    except ImportError:
        return 78
    try:
        with psycopg.connect(os.environ["WORKER_DB_URL"],
                             user=os.environ.get("WORKER_DB_USER"),
                             password=os.environ.get("WORKER_DB_PASSWORD"),
                             autocommit=True, connect_timeout=10) as connection:
            execution = InputExecution(args.job_id, args.run_id, args.execution_id)
            if publishing:
                from model_publication import configured, publish_model
                settings, s3 = configured()
                publish_model(connection, execution, args.model_kind,
                              os.environ["WORKER_STORAGE_DIR"], settings, s3)
            else:
                prepare_features(connection, execution, os.environ["WORKER_STORAGE_DIR"])
        return 0
    except StaleExecution:
        return 79
    except (psycopg.Error, StoreUnavailable, httpx.TransportError, BotoCoreError, ClientError):
        return 75
    except httpx.HTTPStatusError as error:
        return 75 if error.response.status_code in (408, 429) or error.response.status_code >= 500 else 65
    except (ProtocolError, ValueError, KeyError):
        return 65
    except OSError:
        return 74


if __name__ == "__main__":
    raise SystemExit(main())
