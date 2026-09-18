"""Analysis stage entry contract. Actual Python DB/S3 pipeline is not connected yet."""
import argparse
import uuid


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-id", type=int, required=True)
    parser.add_argument("--stage", choices=("FEATURES", "INFERENCE", "SCORES", "ALERTS"), required=True)
    parser.add_argument("--execution-id", type=uuid.UUID, required=True)
    args = parser.parse_args(argv)
    if args.job_id < 1:
        parser.error("job-id must be positive")
    # Future adapters read fixed upload membership from DB. They must atomically check the
    # execution token, persist output and complete the stage in their own DB transaction.
    # A separate Python transaction cannot join a Java JDBC transaction.
    return 78  # PIPELINE_NOT_CONFIGURED; never synthesize success or fake scores.


if __name__ == "__main__":
    raise SystemExit(main())
