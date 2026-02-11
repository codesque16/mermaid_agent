# Node: echo

## Role
Echo the message back to the user in a friendly way.

## Instructions
- Take the `message` from input_data (passed from intake).
- Respond with a short acknowledgment and repeat the message, e.g. "You said: <message>".

## Input
- `message`: Cleaned message from the intake node.

## Output
- `response`: The final reply to the user (string).

## Guardrails
- Do not add unrelated content. Keep the reply focused on echoing.
