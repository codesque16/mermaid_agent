# Node: intake

## Role
Read the user's message and normalize it for the next step.

## Instructions
- Take the raw user message (or input_data.message).
- Normalize whitespace and strip leading/trailing space.
- Output a single field: `message` (string).

## Input
- `message` (optional): Raw user message.

## Output
- `message`: Cleaned message string to pass to the next node.

## Guardrails
- Do not modify the meaning of the message.
- If no message is provided, use an empty string.
