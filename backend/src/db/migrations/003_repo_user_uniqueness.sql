-- Migration: 003_repo_user_uniqueness.sql
-- Description: Replace global repository uniqueness with per-user repository uniqueness

-- 1. Drop existing global uniqueness constraint if it exists
ALTER TABLE repositories DROP CONSTRAINT IF EXISTS uq_repositories_provider_owner_name;

-- 2. Add per-user uniqueness constraint
ALTER TABLE repositories ADD CONSTRAINT uq_repositories_user_provider_owner_name UNIQUE (user_id, provider, owner, name);
