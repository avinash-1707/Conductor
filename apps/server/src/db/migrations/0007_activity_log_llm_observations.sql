ALTER TABLE "activity_log" ADD COLUMN "llm_observations" jsonb DEFAULT '[]'::jsonb NOT NULL;
