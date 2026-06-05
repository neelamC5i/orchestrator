"use client";

import { ObservatoryData, GraphifyData } from "./types";
import { EmptyState } from "./common";
import GraphWorkspace from "./GraphWorkspace";

interface Props {
  data: ObservatoryData;
  graphData: GraphifyData | null;
}

export default function KnowledgeGraphTab({ data, graphData }: Props) {
  const hasGraph = (graphData?.nodes?.length ?? 0) > 0;
  const hasLegacyData =
    (data.knowledge_graph?.entity_growth?.length ?? 0) > 0 ||
    (data.knowledge_graph?.top_connected_entities?.length ?? 0) > 0;

  if (!hasGraph && !hasLegacyData) return <EmptyState />;
  return <GraphWorkspace data={data} graphData={graphData} />;
}
