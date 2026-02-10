# Testing Guide

## Testing Philosophy

An agent should be tested at three levels:
1. **Structural** — Is the graph valid? (validation)
2. **Node-level** — Does each node behave correctly in isolation?
3. **Flow-level** — Does the full path through the graph produce correct results?

## Level 1: Structural Validation

Run the validator:
```bash
python agent_cli.py validate <agent-dir>
```

This checks:
- All required files exist
- Graph has a start and at least one terminal node
- No orphan (disconnected) nodes
- Every non-terminal node has a directory with index.md
- Loops have @max_iterations
- Router edges have @cond

**Fix all errors before proceeding. Warnings are OK but review them.**

## Level 2: Node-Level Testing

For each node, design 2-3 test inputs and expected outputs:

```markdown
### Test: classify node
**Input:** { query: "I can't log into my account" }
**Expected route:** intent == "support"
**Expected output:** { intent: "support", category: "auth", urgency: "medium" }

### Test: classify node (edge case)
**Input:** { query: "" }
**Expected route:** clarity < 0.7 → clarify node
```

Test individually by loading JUST that node's index.md and running
the input through. Check:
- Does it produce the expected output fields?
- Does it route correctly?
- Does it handle edge cases?

## Level 3: Flow-Level Testing

Design end-to-end scenarios that exercise different paths:

### Happy Path Test
The most common path through the graph. Every agent should have this.
```
Input → [node A] → [node B] → [node C] → Output
Verify: correct output, all nodes visited in order
```

### Error Path Test
What happens when something fails?
```
Input → [node A] → [node B fails] → [error handler] → Output
Verify: error is caught, fallback produces reasonable output
```

### Loop Test
Does the quality loop converge?
```
Input → [generate] → [review: fail] → [generate] → [review: pass] → Output
Verify: loop runs expected number of times, quality improves
```

### Edge Case Tests
- Empty input
- Extremely long input
- Input that triggers multiple routing conditions
- Input in unexpected format

## Test Case Format

For each test, document:
```yaml
test_name: "Happy path - simple question"
input:
  query: "What is the capital of France?"
  depth: "quick"
expected_path: [start, intake, search, analyze, synthesize, review, deliver]
expected_output:
  contains: "Paris"
  confidence_min: 0.9
  has_citations: true
```

## Running Tests

Currently, tests are run by walking through the agent manually:
1. Load the SYSTEM_PROMPT.md
2. Feed the test input
3. Observe which nodes are visited (via node_enter calls if using runtime MCP)
4. Compare output against expected

Future: automated test runner that replays test cases via API.

## When to Retest

- After ANY change to agent-mermaid.md (graph structure)
- After changing a node's index.md (behavior change)
- After changing guardrails.yaml (validation change)
- After re-compiling SYSTEM_PROMPT.md
- Before declaring the agent "done"
