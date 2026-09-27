---
name: jkai-scraper
description: "Check available extraction tools and permissions before requesting data from a website or saved browser profile."
---

# jkai-scraper

Discover currently available extraction tools with `tool_search` and inspect
their schemas with `tool_describe`. Canvas no longer offers browser-scraping
nodes. Do not recreate a retired node from a saved graph.

Prefer a supported API or ordinary page retrieval when it supplies the data.
Use only authorized accounts and saved credential/profile handles. Never expose
cookies, credentials or private profile files. Check pagination, date ranges,
units and completeness before treating extraction as successful.

Report blocked authentication, missing tools and incomplete results explicitly.
Changing account state or deleting a profile needs authorization for that action.
