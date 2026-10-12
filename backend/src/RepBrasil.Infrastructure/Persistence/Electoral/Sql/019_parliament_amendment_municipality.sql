ALTER TABLE parliament_amendment
    ADD COLUMN municipality_ibge_code varchar(7);

ALTER TABLE parliament_amendment
    ADD CONSTRAINT parliament_amendment_municipality_ibge_code_ck
    CHECK (municipality_ibge_code IS NULL OR municipality_ibge_code ~ '^[0-9]{7}$');

CREATE INDEX parliament_amendment_municipality_idx
    ON parliament_amendment (municipality_ibge_code, year DESC)
    WHERE municipality_ibge_code IS NOT NULL;
