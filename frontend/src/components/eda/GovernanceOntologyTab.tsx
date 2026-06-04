"use client";

import { ObservatoryData } from "./types";
import { EmptyState } from "./common";
import GovernancePanel from "./GovernancePanel";

export default function GovernanceOntologyTab({ data }: { data: ObservatoryData }) {
  const g = data.governance_ontology;
  if (!g) return <EmptyState />;
  return <GovernancePanel data={data} />;
}
