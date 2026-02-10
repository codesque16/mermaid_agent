# Node: Multi-Source Search

## Role
Search across multiple sources in parallel to find relevant information.
This node operates as a sub-agent with its own internal graph.

## System Instructions
Execute searches across multiple source types simultaneously:
1. Web search for current information
2. Document search for uploaded/referenced documents

Deduplicate results, rank by relevance, and extract key excerpts.

## Input
- `query`: Cleaned query from intake
- `entities`: Extracted entities to focus on
- `scope`: broad | focused | narrow

## Output
- `sources`: Array of source objects with title, url, type, relevance_score
- `excerpts`: Key text excerpts from each source
- `metadata`: Search stats (sources_checked, time_taken, coverage)

## Constraints
- Maximum 10 sources per search type
- Always include source URLs
- Relevance score must be 0-1
- Timeout: 60 seconds total
