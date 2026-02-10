# Interview Protocol: Extracting Agent Requirements

## Philosophy

The interview is NOT a form to fill out. It's a conversation where you
progressively uncover the shape of the agent. Most users don't think in
terms of "nodes" and "edges" — they think in terms of "when X happens,
do Y". Your job is to translate.

## Opening

Start with ONE open question:
> "Tell me what you want this agent to do. Walk me through a typical
> scenario from start to finish."

Listen for:
- **Verbs** → these become nodes (classify, search, generate, review, send)
- **Conditionals** → these become router edges ("if it's urgent", "when quality is low")
- **Tools** → these become tool definitions ("search the web", "check the database")
- **People** → these become human_input nodes ("manager approves", "user confirms")
- **Repetition** → these become loops ("keep refining until it's good")

## Core Questions (ask as needed, not all at once)

### About the Trigger
- What kicks off this agent? A user message? A scheduled event? An incoming email?
- Is the input structured (JSON, form) or unstructured (natural language)?

### About the Process
- What happens first?
- Then what? And after that?
- Are there any steps that happen simultaneously?
- Where might things go wrong? What should happen then?

### About Decisions
- Does the agent ever need to choose between different paths?
- What information does it use to make that choice?
- Are there default/fallback paths?

### About Quality
- How do you know if the output is good enough?
- What would make you reject an output and want to redo it?
- How many retries are acceptable?

### About Tools & Data
- Does the agent need to access any external systems?
- What APIs, databases, or services does it talk to?
- Does it need to search the web?
- Does it need to read/write files?

### About People
- Does a human need to approve anything?
- Where would you want a human checkpoint?
- Who is the end user of this agent's output?

### About Scale & Constraints
- How fast does this need to be?
- Are there cost constraints (model selection)?
- Are there safety/compliance requirements?

## Translation Table

| User says... | Agent concept |
|---|---|
| "First it should figure out what they want" | router node |
| "Look it up" / "Search for" | executor node with search tools |
| "Make sure it's good" / "Check the quality" | validator node |
| "If it's X, do this; if Y, do that" | router with conditional edges |
| "Keep trying until it's right" | loop with @max_iterations |
| "Do these at the same time" | parallel fork/join |
| "A person needs to approve" | human_input node |
| "It's really complex, almost its own thing" | subagent node |
| "Save it" / "Send it" / "Done" | terminal node |

## After the Interview

Immediately draft a graph. Show it. Ask:
> "Here's what I understood. Does this flow look right? What am I missing?"

The visual graph will trigger corrections and additions that no amount
of interviewing would surface. Trust the process.
