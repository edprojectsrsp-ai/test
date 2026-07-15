-- 032_knowledge_graph.sql — Project Brain knowledge graph layer (idempotent)

CREATE TABLE IF NOT EXISTS kg_nodes (
    node_id      serial PRIMARY KEY,
    node_type    text NOT NULL,            -- scheme | package | contractor | document | topic
    ref_id       integer,                  -- FK into the source table when applicable
    label        text NOT NULL,
    props        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (node_type, ref_id, label)
);
CREATE INDEX IF NOT EXISTS kg_nodes_type_ref_idx ON kg_nodes (node_type, ref_id);
CREATE INDEX IF NOT EXISTS kg_nodes_label_trgm ON kg_nodes USING gin (label gin_trgm_ops);

CREATE TABLE IF NOT EXISTS kg_edges (
    edge_id      serial PRIMARY KEY,
    src_id       integer NOT NULL REFERENCES kg_nodes(node_id) ON DELETE CASCADE,
    dst_id       integer NOT NULL REFERENCES kg_nodes(node_id) ON DELETE CASCADE,
    relation     text NOT NULL,            -- has_package | contracted_to | mentioned_in |
                                           -- co_mentioned | caused_delay | granted_eot |
                                           -- has_ld_clause | about
    weight       real NOT NULL DEFAULT 1.0,
    evidence_document_id integer,          -- provenance: which document said so
    evidence_chunk_id    integer,
    props        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS kg_edges_uniq
    ON kg_edges (src_id, dst_id, relation, coalesce(evidence_chunk_id, 0));
CREATE INDEX IF NOT EXISTS kg_edges_src_idx ON kg_edges (src_id, relation);
CREATE INDEX IF NOT EXISTS kg_edges_dst_idx ON kg_edges (dst_id, relation);
