-- 031_ai_retrieval.sql — hybrid retrieval + fuzzy entity layer (idempotent)

-- 1. Entity aliases: fuzzy resolution surface for schemes & packages.
CREATE TABLE IF NOT EXISTS entity_aliases (
    alias_id     serial PRIMARY KEY,
    entity_type  text NOT NULL CHECK (entity_type IN ('scheme','package')),
    entity_id    integer NOT NULL,
    alias        text NOT NULL,
    alias_norm   text GENERATED ALWAYS AS (lower(regexp_replace(alias, '[^a-zA-Z0-9]+', '', 'g'))) STORED,
    source       text NOT NULL DEFAULT 'auto',           -- auto | user | taught
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (entity_type, entity_id, alias)
);
CREATE INDEX IF NOT EXISTS entity_aliases_trgm_idx ON entity_aliases USING gin (alias gin_trgm_ops);
CREATE INDEX IF NOT EXISTS entity_aliases_norm_idx ON entity_aliases (alias_norm);

-- 2. Full-text search on chunks (FTS arm of hybrid retrieval).
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS chunk_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(chunk_text,''))) STORED;
CREATE INDEX IF NOT EXISTS document_chunks_tsv_idx  ON document_chunks USING gin (chunk_tsv);
CREATE INDEX IF NOT EXISTS document_chunks_trgm_idx ON document_chunks USING gin (chunk_text gin_trgm_ops);

-- 3. Ingest provenance on documents (which channel a doc came from).
ALTER TABLE documents ADD COLUMN IF NOT EXISTS ingest_channel text DEFAULT 'upload';
-- values: upload | whatsapp | email | scan | api

-- 4. Vector index (ivfflat needs data; safe if embeddings table small — build lazily).
DO $$
BEGIN
    IF (SELECT count(*) FROM document_embeddings) > 100 THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS document_embeddings_ivf_idx
                 ON document_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists=50)';
    END IF;
END $$;

-- 5. Seed aliases from live scheme/package codes & names (idempotent upsert).
INSERT INTO entity_aliases (entity_type, entity_id, alias, source)
SELECT 'scheme', scheme_id, alias, 'auto'
FROM (
    SELECT scheme_id, unnest(ARRAY[
        scheme_code,
        scheme_name,
        regexp_replace(coalesce(scheme_code,''), '[#_ ]+', '-', 'g'),
        regexp_replace(coalesce(scheme_name,''), '[#_ ]+', '-', 'g')
    ]) AS alias
    FROM scheme_master WHERE NOT coalesce(is_deleted, false)
) s
WHERE alias IS NOT NULL AND length(trim(alias)) BETWEEN 2 AND 200
ON CONFLICT (entity_type, entity_id, alias) DO NOTHING;

INSERT INTO entity_aliases (entity_type, entity_id, alias, source)
SELECT 'package', package_id, alias, 'auto'
FROM (
    SELECT package_id, unnest(ARRAY[
        package_code,
        package_name,
        regexp_replace(coalesce(package_code,''), '[#_ ]+', '-', 'g')
    ]) AS alias
    FROM packages WHERE NOT coalesce(is_deleted, false)
) p
WHERE alias IS NOT NULL AND length(trim(alias)) BETWEEN 2 AND 200
ON CONFLICT (entity_type, entity_id, alias) DO NOTHING;
