"use client";

import WikiCards from "./WikiCards";

type WikiPage = {
  canonical_id?: string;
  title?: string;
  entity_type?: string;
  source_file?: string;
  summary?: string;
  citations?: string[];
  provenance?: string[];
};

export default function WikiTab({ pages }: { pages: WikiPage[] }) {
  return <WikiCards pages={pages} />;
}
