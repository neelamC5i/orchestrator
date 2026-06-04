"use client";

import { ObservatoryData } from "./types";
import EDACompactPanel from "./EDACompactPanel";

export default function EDATab({ data }: { data: ObservatoryData }) {
  return <EDACompactPanel data={data} />;
}
