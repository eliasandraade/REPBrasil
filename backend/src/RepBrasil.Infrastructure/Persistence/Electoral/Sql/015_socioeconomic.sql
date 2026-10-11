CREATE TABLE IF NOT EXISTS indicator (
    code text PRIMARY KEY,
    name text NOT NULL,
    unit text NOT NULL,
    provider text NOT NULL,
    description text NOT NULL,
    derived boolean NOT NULL DEFAULT false,
    derivation text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS socioeconomic_source (
    id bigserial PRIMARY KEY,
    indicator_code text NOT NULL REFERENCES indicator(code) ON DELETE RESTRICT,
    period integer NOT NULL CHECK (period BETWEEN 1900 AND 2200),
    provider text NOT NULL,
    dataset text NOT NULL,
    source_url text NOT NULL,
    retrieved_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    parser_version text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (provider, dataset, indicator_code, period, sha256)
);

CREATE TABLE IF NOT EXISTS indicator_value (
    id bigserial PRIMARY KEY,
    indicator_code text NOT NULL REFERENCES indicator(code) ON DELETE RESTRICT,
    municipality_ibge_code char(7) NOT NULL CHECK (municipality_ibge_code ~ '^[0-9]{7}$'),
    period integer NOT NULL CHECK (period BETWEEN 1900 AND 2200),
    value numeric NOT NULL,
    source_id bigint NOT NULL REFERENCES socioeconomic_source(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (indicator_code, municipality_ibge_code, period, source_id)
);

CREATE INDEX IF NOT EXISTS indicator_value_lookup_idx
    ON indicator_value (indicator_code, period, municipality_ibge_code, source_id DESC);
CREATE INDEX IF NOT EXISTS socioeconomic_source_recency_idx
    ON socioeconomic_source (indicator_code, period, retrieved_at DESC, id DESC);

INSERT INTO indicator (code, name, unit, provider, description, derived, derivation) VALUES
    ('ibge.population', 'População', 'pessoas', 'IBGE/SIDRA', 'População municipal publicada pelo IBGE para o período informado.', false, NULL),
    ('ibge.gdp_total', 'PIB municipal', 'R$ mil', 'IBGE/SIDRA', 'Produto Interno Bruto municipal em milhares de reais. O identificador da tabela/variável deve ser registrado na proveniência da carga.', false, NULL),
    ('derived.gdp_per_capita', 'PIB per capita', 'R$/pessoa', 'REPBrasil', 'PIB per capita derivado somente quando PIB e população pertencem ao mesmo município e ao mesmo período.', true, 'ibge.gdp_total * 1000 / ibge.population'),
    ('atlas.idhm', 'IDHM', 'índice', 'Atlas do Desenvolvimento Humano', 'Índice de Desenvolvimento Humano Municipal conforme publicação oficial importada.', false, NULL)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    unit = EXCLUDED.unit,
    provider = EXCLUDED.provider,
    description = EXCLUDED.description,
    derived = EXCLUDED.derived,
    derivation = EXCLUDED.derivation;
