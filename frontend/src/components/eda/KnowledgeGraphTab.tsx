"use client";

import { ObservatoryData } from "./types";
import { EmptyState } from "./common";
import GraphWorkspace from "./GraphWorkspace";

export default function KnowledgeGraphTab({ data }: { data: ObservatoryData }) {
  const kg = data.knowledge_graph;
  if (!kg?.entity_growth?.length && !kg?.top_connected_entities?.length) return <EmptyState />;
  return <GraphWorkspace data={data} />;
}
