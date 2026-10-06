-- Reset receipts and pending file cleanup survive deletion of demonstration data.
CREATE TABLE demo_resets (
 reset_id UUID PRIMARY KEY, actor_id BIGINT NOT NULL REFERENCES users,
 status TEXT NOT NULL CHECK(status IN ('FILES_PENDING','FILES_FAILED','COMPLETED')),
 storage_scope TEXT NOT NULL, deleted_counts JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ
);
CREATE TABLE demo_reset_files (
 reset_id UUID NOT NULL REFERENCES demo_resets, object_key TEXT NOT NULL,
 is_prefix BOOLEAN NOT NULL, done BOOLEAN NOT NULL DEFAULT false,
 PRIMARY KEY(reset_id,object_key)
);
