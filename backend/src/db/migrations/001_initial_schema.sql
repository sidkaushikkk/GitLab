-- Migration: 001_initial_schema.sql
-- Description: Create initial schema for users, repositories, and analysis_runs tables

-- Enable pgcrypto for UUID generation if needed (gen_random_uuid() is built-in for PG 13+)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. Users Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    github_id BIGINT UNIQUE NOT NULL,
    login VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    avatar_url TEXT,
    email VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for searching users by login
CREATE INDEX IF NOT EXISTS idx_users_login ON users(login);

-- ============================================================================
-- 2. Repositories Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL DEFAULT 'github',
    owner VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    description TEXT,
    default_branch VARCHAR(100) NOT NULL DEFAULT 'main',
    language VARCHAR(100),
    private BOOLEAN NOT NULL DEFAULT false,
    provider_repo_id BIGINT,
    status VARCHAR(50) NOT NULL DEFAULT 'connected',
    last_analyzed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_repositories_provider_owner_name UNIQUE (provider, owner, name)
);

-- Indexes for repositories
CREATE INDEX IF NOT EXISTS idx_repositories_user_id ON repositories(user_id);
CREATE INDEX IF NOT EXISTS idx_repositories_full_name ON repositories(full_name);
CREATE INDEX IF NOT EXISTS idx_repositories_status ON repositories(status);

-- ============================================================================
-- 3. Analysis Runs Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS analysis_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    triggered_by VARCHAR(100) NOT NULL DEFAULT 'manual',
    status VARCHAR(50) NOT NULL DEFAULT 'queued' 
        CONSTRAINT chk_analysis_runs_status CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for analysis runs
CREATE INDEX IF NOT EXISTS idx_analysis_runs_repository_id ON analysis_runs(repository_id);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_status ON analysis_runs(status);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_created_at ON analysis_runs(created_at DESC);
