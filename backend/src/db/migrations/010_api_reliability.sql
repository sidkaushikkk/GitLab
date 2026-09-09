-- Migration: 010_api_reliability.sql
-- Description: Create tables for snapshot-scoped API endpoint inventory, contract extraction, reliability findings, and aggregate reliability summaries (Checkpoint 11)

-- 1. Snapshot API Reliability Summaries Table
CREATE TABLE IF NOT EXISTS snapshot_api_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL UNIQUE REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    total_endpoints INTEGER NOT NULL DEFAULT 0,
    method_distribution JSONB NOT NULL DEFAULT '{}',
    authenticated_count INTEGER NOT NULL DEFAULT 0,
    unauthenticated_count INTEGER NOT NULL DEFAULT 0,
    complete_contract_count INTEGER NOT NULL DEFAULT 0,
    partial_contract_count INTEGER NOT NULL DEFAULT 0,
    unknown_contract_count INTEGER NOT NULL DEFAULT 0,
    total_findings INTEGER NOT NULL DEFAULT 0,
    findings_by_severity JSONB NOT NULL DEFAULT '{}',
    reliability_score NUMERIC(5, 2) NOT NULL DEFAULT 100.00,
    score_breakdown JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_summaries_snapshot 
ON snapshot_api_summaries(snapshot_id);

CREATE INDEX IF NOT EXISTS idx_api_summaries_repo 
ON snapshot_api_summaries(repository_id);

-- 2. Snapshot API Endpoints Table (Detailed Endpoint Inventory & Contracts)
CREATE TABLE IF NOT EXISTS snapshot_api_endpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    method VARCHAR(16) NOT NULL,
    route_path TEXT NOT NULL,
    source_file TEXT NOT NULL,
    source_line INTEGER NOT NULL,
    router_name VARCHAR(128),
    handler_name VARCHAR(128),
    is_authenticated BOOLEAN NOT NULL DEFAULT false,
    has_authorization BOOLEAN NOT NULL DEFAULT false,
    auth_middleware JSONB NOT NULL DEFAULT '[]',
    middleware_chain JSONB NOT NULL DEFAULT '[]',
    parameters JSONB NOT NULL DEFAULT '[]',
    request_body JSONB NOT NULL DEFAULT '{}',
    response_status_codes JSONB NOT NULL DEFAULT '[]',
    response_shapes JSONB NOT NULL DEFAULT '[]',
    contract_completeness VARCHAR(20) NOT NULL DEFAULT 'PARTIAL',
    error_handling_coverage VARCHAR(20) NOT NULL DEFAULT 'PARTIAL',
    dependency_depth INTEGER NOT NULL DEFAULT 0,
    database_dependent BOOLEAN NOT NULL DEFAULT false,
    external_dependent BOOLEAN NOT NULL DEFAULT false,
    downstream_calls JSONB NOT NULL DEFAULT '[]',
    reliability_score NUMERIC(5, 2) NOT NULL DEFAULT 100.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_snapshot_endpoint UNIQUE (snapshot_id, method, route_path)
);

CREATE INDEX IF NOT EXISTS idx_api_endpoints_snapshot 
ON snapshot_api_endpoints(snapshot_id);

CREATE INDEX IF NOT EXISTS idx_api_endpoints_repo 
ON snapshot_api_endpoints(repository_id);

CREATE INDEX IF NOT EXISTS idx_api_endpoints_method_path 
ON snapshot_api_endpoints(method, route_path);

-- 3. Snapshot API Reliability Findings Table
CREATE TABLE IF NOT EXISTS snapshot_api_findings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    endpoint_id UUID REFERENCES snapshot_api_endpoints(id) ON DELETE CASCADE,
    rule_id VARCHAR(64) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    category VARCHAR(64) NOT NULL,
    method VARCHAR(16) NOT NULL,
    route_path TEXT NOT NULL,
    source_file TEXT NOT NULL,
    source_line INTEGER NOT NULL,
    evidence TEXT NOT NULL,
    explanation TEXT NOT NULL,
    remediation TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_snapshot_finding UNIQUE (snapshot_id, rule_id, method, route_path)
);

CREATE INDEX IF NOT EXISTS idx_api_findings_snapshot 
ON snapshot_api_findings(snapshot_id);

CREATE INDEX IF NOT EXISTS idx_api_findings_repo 
ON snapshot_api_findings(repository_id);

CREATE INDEX IF NOT EXISTS idx_api_findings_rule 
ON snapshot_api_findings(rule_id);
