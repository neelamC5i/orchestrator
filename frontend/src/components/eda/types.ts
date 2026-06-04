export type ObservatoryTab =
  | "Pipeline"
  | "Overview"
  | "Extraction"
  | "Metadata"
  | "EDA"
  | "Knowledge Graph"
  | "Confidence"
  | "Validation & Trust"
  | "Governance & Ontology";

export interface PipelineStageRow {
  id: string;
  label: string;
  status: string;
  pct?: number;
  detail?: string;
  input_size_bytes?: number | null;
  output_size_bytes?: number | null;
  processing_time_ms?: number | null;
  warnings?: string[];
  errors?: string[];
}

export interface ObservatoryData {
  job_id: string;
  domain_label?: string;
  status?: string;
  has_data: boolean;
  overview: {
    entities_count?: number | null;
    relationships_count?: number | null;
    graph_nodes?: number | null;
    trust_score?: number | null;
    ontology_consistency?: number | null;
  };
  pipeline: {
    stages: PipelineStageRow[];
  };
  extraction: {
    parser_confidence: Array<{ source_file: string; adapter?: string | null; confidence?: number | null }>;
    ocr_confidence_timeline: Array<{ source_file: string; point: number; confidence?: number | null }>;
    lineage: Array<{
      chunk_id: string;
      source_file: string;
      adapter?: string | null;
      confidence?: number | null;
      page_row?: string | number | null;
      entity_count?: number | null;
      warnings?: string[];
    }>;
  };
  metadata: {
    completeness: Array<{ target: string; score?: number | null }>;
    missing_schema_fields: Array<{ target: string; field: string }>;
    type_coverage: Array<{ target: string; coverage?: number | null }>;
    richness_heatmap: Array<{ target: string; richness?: number | null }>;
  };
  eda: {
    column_statistics: Array<{
      file_id: string;
      column: string;
      mean?: number | null;
      median?: number | null;
      std?: number | null;
      p10?: number | null;
      p90?: number | null;
    }>;
    histograms: Array<{ file_id: string; column: string; bins: Array<{ bin_start: number; bin_end: number; count: number }> }>;
    outliers: Array<Record<string, unknown>>;
    box_plots: Array<Record<string, unknown>>;
  };
  knowledge_graph: {
    entity_growth: Array<{ job_id: string; created_at: string; count: number }>;
    relationship_growth: Array<{ job_id: string; created_at: string; count: number }>;
    top_connected_entities: Array<{ entity: string; degree: number }>;
    orphan_nodes_count?: number | null;
  };
  confidence: {
    stages: string[];
    matrix: Array<{ entity: string; stages: Record<string, number | null | undefined> }>;
    breakdown: Record<string, {
      entity: string;
      canonical_id?: string;
      entity_type?: string;
      stages: Record<string, number | null | undefined>;
      source_files?: string[];
    }>;
  };
  validation_trust: {
    validation_errors: {
      schema?: number | null;
      nulls?: number | null;
      duplicates?: number | null;
    };
    ontology_violations?: number | null;
    orphan_nodes?: number | null;
    trust_breakdown: {
      trust_score?: number | null;
      consistency?: number | null;
      confidence?: number | null;
      graph_trust?: number | null;
      f1_proxy?: number | null;
    };
  };
  governance_ontology: {
    ontology_consistency_score?: number | null;
    relationship_type_violations?: number | null;
    schema_adherence: {
      type_count?: number | null;
      relation_count?: number | null;
      constraints?: number | null;
    };
    governance_alerts: Array<Record<string, unknown>>;
  };
}
