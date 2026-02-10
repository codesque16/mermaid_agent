"""
Agent Mermaid DSL Parser

Parses extended mermaid flowcharts into a structured agent graph.
Extracts node metadata (@type, @model, etc.) and edge conditions (@cond, @pass, etc.)
"""

import re
import json
import yaml
from dataclasses import dataclass, field, asdict
from typing import Optional
from pathlib import Path


@dataclass
class NodeMeta:
    id: str
    display_name: str
    node_type: str = "executor"
    model: Optional[str] = None
    retry: int = 1
    timeout: Optional[str] = None
    tools: Optional[str] = None
    threshold: Optional[float] = None
    strategy: Optional[str] = None
    channel: Optional[str] = None
    max_iterations: Optional[int] = None
    shape: str = "rectangle"  # rectangle, diamond, circle, hexagon, stadium

    def to_dict(self):
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class EdgeMeta:
    source: str
    target: str
    condition: Optional[str] = None
    pass_fields: Optional[str] = None
    transform: Optional[str] = None
    fallback: bool = False
    on_error: bool = False
    max_iterations: Optional[int] = None
    label_raw: Optional[str] = None

    def to_dict(self):
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class AgentGraph:
    nodes: dict = field(default_factory=dict)       # id -> NodeMeta
    edges: list = field(default_factory=list)        # list of EdgeMeta
    start_node: Optional[str] = None
    terminal_nodes: list = field(default_factory=list)

    def to_dict(self):
        return {
            "nodes": {k: v.to_dict() for k, v in self.nodes.items()},
            "edges": [e.to_dict() for e in self.edges],
            "start_node": self.start_node,
            "terminal_nodes": self.terminal_nodes,
        }

    def get_children(self, node_id: str) -> list:
        return [e for e in self.edges if e.source == node_id]

    def get_parents(self, node_id: str) -> list:
        return [e for e in self.edges if e.target == node_id]

    def topological_sort(self) -> list:
        """Returns nodes in topological order for system prompt generation."""
        visited = set()
        order = []
        adj = {}
        for e in self.edges:
            adj.setdefault(e.source, []).append(e.target)

        def dfs(node):
            if node in visited:
                return
            visited.add(node)
            for child in adj.get(node, []):
                dfs(child)
            order.append(node)

        if self.start_node:
            dfs(self.start_node)
        for n in self.nodes:
            if n not in visited:
                dfs(n)

        order.reverse()
        return order


def parse_node_metadata(label: str) -> dict:
    """Extract @key: value pairs from a node label."""
    meta = {}
    # First line is the display name
    lines = label.strip().split('\n')
    meta['display_name'] = lines[0].strip()

    for line in lines[1:]:
        line = line.strip()
        match = re.match(r'@(\w+):\s*(.+)', line)
        if match:
            key, value = match.group(1), match.group(2).strip()
            # Type coercion
            if key in ('retry', 'max_iterations'):
                value = int(value)
            elif key == 'threshold':
                value = float(value)
            elif value.lower() in ('true', 'false'):
                value = value.lower() == 'true'
            meta[key] = value

    return meta


def parse_edge_metadata(label: str) -> dict:
    """Extract @key: value pairs from an edge label."""
    meta = {'label_raw': label}
    if not label:
        return meta

    for match in re.finditer(r'@(\w+):\s*([^\n@]+)', label):
        key, value = match.group(1), match.group(2).strip()
        if key == 'cond':
            meta['condition'] = value
        elif key == 'pass':
            meta['pass_fields'] = value
        elif key == 'transform':
            meta['transform'] = value
        elif key == 'on_error':
            meta['on_error'] = value.lower() == 'true'
        elif key == 'fallback':
            meta['fallback'] = value.lower() == 'true'
        elif key == 'max_iterations':
            meta['max_iterations'] = int(value)

    return meta


def detect_shape(raw_line: str, node_id: str) -> str:
    """Detect mermaid node shape from syntax."""
    # Check the characters after the node_id
    patterns = {
        '(("': 'double_circle',
        '("': 'stadium',
        '{"': 'diamond_alt',
        '{{"': 'hexagon',
        '["': 'rectangle',
        '(': 'circle',
        '{': 'diamond',
        '([': 'subroutine',
        '[[': 'subroutine',
        '>': 'flag',
    }
    after_id = raw_line[raw_line.index(node_id) + len(node_id):] if node_id in raw_line else ''
    for pattern, shape in patterns.items():
        if after_id.startswith(pattern):
            return shape
    return 'rectangle'


def parse_mermaid(content: str) -> AgentGraph:
    """Parse a mermaid flowchart string into an AgentGraph."""
    graph = AgentGraph()

    # Remove mermaid code fence
    content = re.sub(r'```mermaid\s*', '', content)
    content = re.sub(r'```\s*$', '', content)

    # Remove graph direction line
    content = re.sub(r'^\s*graph\s+(TD|LR|BT|RL)\s*$', '', content, flags=re.MULTILINE)

    # Remove comment lines
    content = re.sub(r'^\s*%%.*$', '', content, flags=re.MULTILINE)

    # --- Parse node definitions ---
    # Strategy: find node definitions by matching id + bracket pairs,
    # handling multi-line labels by joining continuation lines first.
    
    # Join multi-line node definitions: lines that start with @
    # or are indentation-continued belong to previous line
    joined_lines = []
    for line in content.split('\n'):
        stripped = line.strip()
        if not stripped:
            continue
        # If line starts with @ or is a continuation inside quotes, append to previous
        if stripped.startswith('@') and joined_lines:
            joined_lines[-1] += '\n' + stripped
        else:
            joined_lines.append(stripped)
    
    full_text = '\n'.join(joined_lines)

    # Now parse nodes — match id + delimiters with content between quotes
    node_patterns = [
        # Double circle: id(("..."))
        (r'(\w+)\(\("((?:[^"]|\n)*?)"\)\)', 'double_circle'),
        # Stadium: id("...")
        (r'(\w+)\("((?:[^"]|\n)*?)"\)', 'stadium'),
        # Hexagon: id{{"..."}}
        (r'(\w+)\{\{"((?:[^"]|\n)*?)"\}\}', 'hexagon'),
        # Rectangle: id["..."]
        (r'(\w+)\["((?:[^"]|\n)*?)"\]', 'rectangle'),
        # Diamond: id{"..."}  
        (r'(\w+)\{"((?:[^"]|\n)*?)"\}', 'diamond'),
        # Circle/round without quotes: id((text))
        (r'(\w+)\(\(([^)]*?)\)\)', 'double_circle'),
    ]

    for pattern, shape in node_patterns:
        for match in re.finditer(pattern, full_text, re.DOTALL):
            node_id = match.group(1)
            if node_id in graph.nodes:
                continue
            label = match.group(2)
            meta = parse_node_metadata(label)
            display_name = meta.pop('display_name', node_id)
            node_type = meta.pop('type', 'executor')

            valid_fields = {f.name for f in NodeMeta.__dataclass_fields__.values()} - {'id', 'display_name', 'node_type', 'shape'}
            extra = {k: v for k, v in meta.items() if k in valid_fields}

            node = NodeMeta(
                id=node_id,
                display_name=display_name,
                node_type=node_type,
                shape=shape,
                **extra
            )
            graph.nodes[node_id] = node

    # --- Parse edges ---
    # Strategy: normalize the mermaid content to make edges easier to parse
    # First, collapse multi-line edge labels into single lines
    # Then extract edges with a simpler pattern
    
    # Rebuild content with all edge-related info on single lines
    # Find all -->|"..."| patterns (possibly multi-line) and normalize
    edge_text = full_text
    
    # Collapse multi-line edge labels: -->|"\n...\n..."| into single line
    edge_text = re.sub(r'\|"((?:[^"])*?)"\|', 
                       lambda m: '|"' + m.group(1).replace('\n', ' ') + '"|', 
                       edge_text, flags=re.DOTALL)
    
    for line in edge_text.split('\n'):
        line = line.strip()
        if '-->' not in line and '---' not in line:
            continue
            
        # Handle chained edges on one line: A --> B --> C
        # And also A -->|"label"| B
        # Split by --> while capturing labels
        
        # Find all segments: each is either a node ref or -->|"label"|
        # Simple approach: split on --> and process pairs
        parts = re.split(r'\s*(-->|---)\s*', line)
        
        # parts will be like: ['A', '-->', '|"label"| B', '-->', 'C']
        # or: ['A', '-->', 'B']
        
        i = 0
        while i < len(parts) - 2:
            left = parts[i].strip()
            arrow = parts[i+1]  # --> or ---
            right = parts[i+2].strip()
            
            # Extract label from right side if present
            label = ""
            label_match = re.match(r'\|"(.*?)"\|\s*(.*)', right)
            if label_match:
                label = label_match.group(1)
                right = label_match.group(2).strip()
            
            # Extract source nodes (handle A & B & C)
            # Left might end with a label from a previous node def, skip those
            sources = [s.strip() for s in left.split('&')]
            sources = [s for s in sources if re.match(r'^\w+$', s)]
            
            # Right might contain & for multiple targets
            targets = [t.strip() for t in right.split('&')]
            targets = [t for t in targets if re.match(r'^\w+$', t)]
            
            edge_meta = parse_edge_metadata(label)
            
            for src in sources:
                for tgt in targets:
                    for nid in [src, tgt]:
                        if nid not in graph.nodes:
                            graph.nodes[nid] = NodeMeta(id=nid, display_name=nid)
                    
                    valid_edge_fields = {f.name for f in EdgeMeta.__dataclass_fields__.values()} - {'source', 'target'}
                    edge_extra = {k: v for k, v in edge_meta.items() if k in valid_edge_fields}
                    
                    edge = EdgeMeta(source=src, target=tgt, **edge_extra)
                    graph.edges.append(edge)
            
            i += 2  # Move to next pair

    # Identify start and terminal nodes
    for nid, node in graph.nodes.items():
        if node.node_type == 'terminal':
            if node.display_name.upper().startswith('START'):
                graph.start_node = nid
            else:
                graph.terminal_nodes.append(nid)

    # If no explicit start, find node with no incoming edges
    if not graph.start_node:
        targets = {e.target for e in graph.edges}
        sources = {e.source for e in graph.edges}
        roots = sources - targets
        if roots:
            graph.start_node = list(roots)[0]

    return graph


def load_agent(agent_dir: str) -> dict:
    """Load a complete agent definition from a directory."""
    agent_path = Path(agent_dir)

    result = {
        "path": str(agent_path),
        "graph": None,
        "config": None,
        "index": None,
        "nodes": {},
    }

    # Load mermaid graph
    mermaid_file = agent_path / "agent-mermaid.md"
    if mermaid_file.exists():
        content = mermaid_file.read_text()
        result["graph"] = parse_mermaid(content)

    # Load config
    config_file = agent_path / "agent-config.yaml"
    if config_file.exists():
        result["config"] = yaml.safe_load(config_file.read_text())

    # Load index
    index_file = agent_path / "index.md"
    if index_file.exists():
        result["index"] = index_file.read_text()

    # Load node definitions
    nodes_dir = agent_path / "nodes"
    if nodes_dir.exists():
        for node_dir in nodes_dir.iterdir():
            if node_dir.is_dir():
                node_data = {"path": str(node_dir)}

                node_index = node_dir / "index.md"
                if node_index.exists():
                    node_data["instructions"] = node_index.read_text()

                tools_file = node_dir / "tools.yaml"
                if tools_file.exists():
                    node_data["tools"] = yaml.safe_load(tools_file.read_text())

                guardrails_file = node_dir / "guardrails.yaml"
                if guardrails_file.exists():
                    node_data["guardrails"] = yaml.safe_load(guardrails_file.read_text())

                # Check for recursive sub-agent
                sub_mermaid = node_dir / "agent-mermaid.md"
                if sub_mermaid.exists():
                    node_data["sub_agent"] = load_agent(str(node_dir))

                # Load references
                refs_dir = node_dir / "references"
                if refs_dir.exists():
                    node_data["references"] = []
                    for ref in refs_dir.iterdir():
                        if ref.is_file():
                            node_data["references"].append({
                                "name": ref.name,
                                "content": ref.read_text() if ref.stat().st_size < 50000 else f"[Large file: {ref.name}]"
                            })

                result["nodes"][node_dir.name] = node_data

    return result


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        agent = load_agent(sys.argv[1])
        if agent["graph"]:
            print(json.dumps(agent["graph"].to_dict(), indent=2))
        else:
            print("No agent-mermaid.md found")
    else:
        print("Usage: python parser.py <agent-directory>")
