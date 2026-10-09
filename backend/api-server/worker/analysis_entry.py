"""Single backend worker entry point, invoked by Spring for a claimed stage."""
import argparse
import os
import uuid


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-id", type=int, required=True)
    parser.add_argument("--stage", choices=("INTEGRATE", "FEATURES", "INFERENCE", "SCORES", "ALERTS"), required=True)
    parser.add_argument("--execution-id", type=uuid.UUID, required=True)
    parser.add_argument("--run-id", type=uuid.UUID)
    parser.add_argument("--operation", choices=("PUBLISH",))
    parser.add_argument("--model-kind", choices=("BINARY", "TYPE"))
    args = parser.parse_args(argv)
    if args.job_id < 1:
        parser.error("job-id must be positive")
    if args.stage == 'INTEGRATE':
        if args.run_id is not None or args.operation is not None or args.model_kind is not None:
            return 65
        return integrate(args.job_id,args.execution_id)
    publishing = args.stage == "INFERENCE" and args.operation == "PUBLISH" and args.model_kind is not None
    preparing = args.stage == "FEATURES" and args.operation is None and args.model_kind is None
    ticking = args.stage == "INFERENCE" and args.operation is None and args.model_kind is None
    scoring = args.stage == "SCORES" and args.operation is None and args.model_kind is None
    alerting = args.stage == "ALERTS" and args.operation is None and args.model_kind is None
    if (ticking or scoring) and not all(os.environ.get(k) for k in ('INFERENCE_API_URL', 'INFERENCE_API_TOKEN', 'S3_BUCKET')):
        return 78
    if (not (preparing or publishing or ticking or scoring or alerting) or os.environ.get("WORKER_MODE") != "demo"
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
            if connection.execute("SELECT has_schema_privilege(current_user,'private','USAGE') OR has_schema_privilege(current_user,'evaluation','USAGE')").fetchone()[0]:
                return 78
            execution = InputExecution(args.job_id, args.run_id, args.execution_id)
            if alerting:
                from alert_pipeline import save_alerts
                save_alerts(connection, execution)
            elif publishing or ticking or scoring:
                from model_publication import configured, publish_model
                settings, s3 = configured()
                if scoring:
                    from result_collection import save_scores
                    save_scores(connection, execution, os.environ["WORKER_STORAGE_DIR"], settings, s3)
                elif ticking:
                    from inference_dispatch import advance
                    return advance(connection, execution, os.environ["WORKER_STORAGE_DIR"], settings, s3)
                else:
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


def integrate(job_id, execution_id):
    try:
        import psycopg
        from private_data import PrivateDataProtector
        from report_integration import integrate_job, ReportRevisionChanged
        from frozen_input import StaleExecution
        protector = PrivateDataProtector(os.environ['INGEST_ENCRYPTION_KEY'],os.environ['INGEST_SEARCH_KEY'],os.environ['INGEST_KEY_VERSION'])
        with psycopg.connect(os.environ['WORKER_DB_URL'],user=os.environ.get('WORKER_DB_USER'),
                password=os.environ.get('WORKER_DB_PASSWORD'),autocommit=True,connect_timeout=10) as db:
            integrate_job(db,job_id,execution_id,protector,os.environ['INGEST_FX_VERSION'])
        return 0
    except (ImportError,KeyError):
        return 78
    except ReportRevisionChanged:
        return 81
    except StaleExecution:
        return 79
    except psycopg.Error:
        return 75
    except ValueError as error:
        return 82 if str(error) == 'CUTOFF_SUPERSEDED' else 65


if __name__ == "__main__":
    raise SystemExit(main())
