ALTER TABLE nodes ADD COLUMN IF NOT EXISTS health_history jsonb DEFAULT '[]'::jsonb;
