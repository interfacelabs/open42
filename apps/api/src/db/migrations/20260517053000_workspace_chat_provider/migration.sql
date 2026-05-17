ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "chat_provider" "llm_provider" DEFAULT 'anthropic' NOT NULL;
