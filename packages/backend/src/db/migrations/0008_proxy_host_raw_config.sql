ALTER TABLE proxy_hosts ADD COLUMN IF NOT EXISTS raw_config text;
ALTER TABLE proxy_hosts ADD COLUMN IF NOT EXISTS raw_config_enabled boolean DEFAULT false;
ALTER TABLE proxy_hosts ADD COLUMN IF NOT EXISTS health_history jsonb DEFAULT '[]'::jsonb;
