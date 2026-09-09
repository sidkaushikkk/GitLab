-- Migration: 008_security_advisories_and_scans.sql
-- Description: Create tables for vulnerability advisories cache, package query cache, snapshot findings, and security scan lifecycle (Checkpoint 9 Phases C & D)

-- 1. Vulnerability Advisories Global Intelligence Cache Table
CREATE TABLE IF NOT EXISTS vulnerability_advisories (
    id VARCHAR(100) PRIMARY KEY, -- Primary OSV/GHSA ID
    canonical_id VARCHAR(100) NOT NULL, -- Canonical CVE or GHSA ID
    aliases TEXT[] NOT NULL DEFAULT '{}',
    ecosystem VARCHAR(50) NOT NULL,
    package_name VARCHAR(255) NOT NULL,
    normalized_name VARCHAR(255) NOT NULL,
    summary TEXT,
    details TEXT,
    severity VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN', -- 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'
    cvss_score DOUBLE PRECISION,
    cvss_vector TEXT,
    affected_ranges JSONB NOT NULL DEFAULT '[]',
    affected_versions TEXT[] NOT NULL DEFAULT '{}',
    fixed_versions TEXT[] NOT NULL DEFAULT '{}',
    advisory_references JSONB NOT NULL DEFAULT '[]',
    published_at TIMESTAMPTZ,
    modified_at TIMESTAMPTZ,
    withdrawn_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_advisories_canonical ON vulnerability_advisories(canonical_id);
CREATE INDEX IF NOT EXISTS idx_advisories_eco_pkg ON vulnerability_advisories(ecosystem, normalized_name);
CREATE INDEX IF NOT EXISTS idx_advisories_severity ON vulnerability_advisories(severity);

-- 2. Package Query Cache Table (Tracks OSV lookups including 0-vulnerability packages to avoid redundant network calls)
CREATE TABLE IF NOT EXISTS package_query_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ecosystem VARCHAR(50) NOT NULL,
    package_name VARCHAR(255) NOT NULL,
    normalized_name VARCHAR(255) NOT NULL,
    version VARCHAR(100) NOT NULL,
    advisory_ids TEXT[] NOT NULL DEFAULT '{}',
    queried_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_package_query_cache UNIQUE (ecosystem, normalized_name, version)
);

CREATE INDEX IF NOT EXISTS idx_pkg_cache_lookup ON package_query_cache(ecosystem, normalized_name, version);
CREATE INDEX IF NOT EXISTS idx_pkg_cache_queried_at ON package_query_cache(queried_at);

-- 3. Security Scans Lifecycle Table
CREATE TABLE IF NOT EXISTS security_scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    security_score INTEGER NOT NULL DEFAULT 100,
    total_dependencies INTEGER NOT NULL DEFAULT 0,
    vulnerable_packages INTEGER NOT NULL DEFAULT 0,
    total_vulnerabilities INTEGER NOT NULL DEFAULT 0,
    critical_count INTEGER NOT NULL DEFAULT 0,
    high_count INTEGER NOT NULL DEFAULT 0,
    medium_count INTEGER NOT NULL DEFAULT 0,
    low_count INTEGER NOT NULL DEFAULT 0,
    unknown_count INTEGER NOT NULL DEFAULT 0,
    direct_vulnerabilities INTEGER NOT NULL DEFAULT 0,
    transitive_vulnerabilities INTEGER NOT NULL DEFAULT 0,
    scan_duration_ms INTEGER,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_scans_snapshot_id ON security_scans(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_sec_scans_repo_date ON security_scans(repository_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sec_scans_status ON security_scans(status);

-- 4. Snapshot Vulnerabilities Findings Table (Snapshot-bound vulnerability findings)
CREATE TABLE IF NOT EXISTS snapshot_vulnerabilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL REFERENCES repository_snapshots(id) ON DELETE CASCADE,
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    dependency_id UUID REFERENCES snapshot_dependencies(id) ON DELETE SET NULL,
    advisory_id VARCHAR(100) REFERENCES vulnerability_advisories(id) ON DELETE CASCADE,
    canonical_id VARCHAR(100) NOT NULL,
    aliases TEXT[] NOT NULL DEFAULT '{}',
    package_name VARCHAR(255) NOT NULL,
    installed_version VARCHAR(100) NOT NULL,
    is_direct BOOLEAN NOT NULL DEFAULT true,
    dependency_scope VARCHAR(50) NOT NULL DEFAULT 'production',
    depth INTEGER NOT NULL DEFAULT 1,
    parent_package VARCHAR(255) NOT NULL DEFAULT '',
    source_file TEXT NOT NULL,
    severity VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN',
    cvss_score DOUBLE PRECISION,
    cvss_vector TEXT,
    title TEXT,
    description TEXT,
    remediation TEXT,
    fixed_versions TEXT[] NOT NULL DEFAULT '{}',
    status VARCHAR(50) NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'In Review', 'Resolved')),
    first_seen_snapshot_id UUID REFERENCES repository_snapshots(id) ON DELETE SET NULL,
    resolved_at_snapshot_id UUID REFERENCES repository_snapshots(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_snapshot_vulnerability UNIQUE (snapshot_id, package_name, canonical_id)
);

CREATE INDEX IF NOT EXISTS idx_snap_vulns_snapshot_id ON snapshot_vulnerabilities(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_snap_vulns_repo_id ON snapshot_vulnerabilities(repository_id);
CREATE INDEX IF NOT EXISTS idx_snap_vulns_severity ON snapshot_vulnerabilities(snapshot_id, severity);
CREATE INDEX IF NOT EXISTS idx_snap_vulns_canonical ON snapshot_vulnerabilities(canonical_id);
CREATE INDEX IF NOT EXISTS idx_snap_vulns_is_direct ON snapshot_vulnerabilities(snapshot_id, is_direct);
