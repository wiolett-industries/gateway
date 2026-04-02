ALTER TABLE permission_groups ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES permission_groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS permission_groups_parent_id_idx ON permission_groups(parent_id);
