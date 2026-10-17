-- psql variable worker_role must identify a dedicated NOSUPERUSER NOCREATEDB
-- NOCREATEROLE NOINHERIT login without membership in the API/owner role.
GRANT USAGE ON SCHEMA core, ledger, analysis, review TO :"worker_role";
GRANT SELECT ON core.assignable_staff, ledger.transactions TO :"worker_role";
GRANT SELECT(user_id,last_assigned_at) ON core.users TO :"worker_role";
-- Name-free categories for model input; names and identities stay in private.
GRANT SELECT(owner_id,entity_type) ON core.owners TO :"worker_role";
GRANT SELECT(bank_id,country) ON core.banks TO :"worker_role";
REVOKE UPDATE(last_assigned_at) ON core.users FROM :"worker_role";
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA analysis TO :"worker_role";
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA analysis TO :"worker_role";
GRANT SELECT ON ALL TABLES IN SCHEMA review TO :"worker_role";
REVOKE INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA review FROM :"worker_role";
REVOKE USAGE,SELECT ON SEQUENCE review.case_id FROM :"worker_role";
REVOKE ALL ON SCHEMA private,evaluation,ingest,ops FROM :"worker_role";
REVOKE ALL ON ALL TABLES IN SCHEMA private,evaluation FROM :"worker_role";
