-- Preserve user IDs, assignments and audit history; never provision a password.
ALTER TABLE users DROP CONSTRAINT users_role_check;
UPDATE users SET role='STAFF' WHERE role IN ('L1','L2');
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('STAFF','ADMIN'));
