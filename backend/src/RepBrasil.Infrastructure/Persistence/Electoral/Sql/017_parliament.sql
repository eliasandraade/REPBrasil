CREATE TABLE IF NOT EXISTS parliament_source (
    id bigserial PRIMARY KEY,
    provider text NOT NULL,
    dataset text NOT NULL,
    source_url text NOT NULL,
    retrieved_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    parser_version text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (provider, dataset, sha256)
);

CREATE TABLE IF NOT EXISTS parliament_member (
    id bigserial PRIMARY KEY,
    institution text NOT NULL CHECK (institution IN ('camara', 'senado', 'alece')),
    external_id text NOT NULL,
    name text NOT NULL,
    parliamentary_name text,
    state_code char(2),
    party_acronym text,
    photo_url text,
    person_id uuid REFERENCES public."Persons"("Id") ON DELETE SET NULL,
    official_document_hash char(64) CHECK (official_document_hash IS NULL OR official_document_hash ~ '^[0-9a-f]{64}$'),
    identity_method text NOT NULL DEFAULT 'unlinked' CHECK (identity_method IN ('official_document', 'unlinked')),
    source_id bigint NOT NULL REFERENCES parliament_source(id) ON DELETE RESTRICT,
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (institution, external_id),
    CHECK (
        (identity_method = 'unlinked' AND person_id IS NULL AND official_document_hash IS NULL)
        OR
        (identity_method = 'official_document' AND person_id IS NOT NULL AND official_document_hash IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS parliament_mandate (
    id bigserial PRIMARY KEY,
    member_id bigint NOT NULL REFERENCES parliament_member(id) ON DELETE CASCADE,
    external_id text NOT NULL,
    legislature text,
    office text NOT NULL,
    state_code char(2),
    party_acronym text,
    starts_on date,
    ends_on date,
    status text,
    source_id bigint NOT NULL REFERENCES parliament_source(id) ON DELETE RESTRICT,
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (member_id, external_id)
);

CREATE TABLE IF NOT EXISTS parliament_activity (
    id bigserial PRIMARY KEY,
    member_id bigint NOT NULL REFERENCES parliament_member(id) ON DELETE CASCADE,
    institution text NOT NULL CHECK (institution IN ('camara', 'senado', 'alece')),
    activity_type text NOT NULL,
    external_id text NOT NULL,
    occurred_at timestamptz,
    title text,
    description text,
    source_url text,
    source_id bigint NOT NULL REFERENCES parliament_source(id) ON DELETE RESTRICT,
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (institution, activity_type, external_id, member_id)
);

CREATE TABLE IF NOT EXISTS parliament_amendment (
    id bigserial PRIMARY KEY,
    external_id text NOT NULL,
    author_member_id bigint REFERENCES parliament_member(id) ON DELETE SET NULL,
    author_name text,
    year integer CHECK (year IS NULL OR year BETWEEN 1988 AND 2200),
    amendment_type text,
    functional_programming text,
    beneficiary_document text,
    beneficiary_name text,
    locality text,
    committed_amount numeric(20,2),
    paid_amount numeric(20,2),
    source_id bigint NOT NULL REFERENCES parliament_source(id) ON DELETE RESTRICT,
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (external_id, source_id)
);

CREATE INDEX IF NOT EXISTS parliament_member_person_idx
    ON parliament_member (person_id) WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS parliament_member_lookup_idx
    ON parliament_member (institution, state_code, party_acronym);
CREATE INDEX IF NOT EXISTS parliament_activity_member_idx
    ON parliament_activity (member_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS parliament_amendment_author_idx
    ON parliament_amendment (author_member_id, year DESC);
CREATE INDEX IF NOT EXISTS parliament_source_recency_idx
    ON parliament_source (provider, dataset, retrieved_at DESC, id DESC);
