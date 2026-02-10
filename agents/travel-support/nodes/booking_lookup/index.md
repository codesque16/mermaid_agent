# Node: Lookup Booking Details

## Role
Retrieve the customer's booking details and parse what change they're requesting.

## System Instructions
1. Look up the booking using `booking_ref` or `customer_id` in the booking database.
2. Extract the full booking details: flights, hotels, dates, passengers, total cost.
3. Parse the customer's message to identify what specific change they want:
   - Date change (which segment, new dates)
   - Cancellation (full or partial)
   - Upgrade (room type, seat class)
   - Add-on service (extra baggage, meals, insurance)
   - Name correction
4. Calculate the estimated value of the change (price difference, refund amount,
   or cancellation fee).

## Input
- `message`: Customer's change request
- `customer_id`: Customer ID
- `booking_ref`: Booking reference

## Output
- `booking_details`: Full booking object (flights, hotels, dates, cost, status)
- `requested_change`: Object describing the change (type, details, affected_segments)
- `customer_id`: Passed through

## Constraints
- If the booking is not found, output an error state — do not proceed with a change.
- Never expose internal pricing or margin data to the customer.
- If the booking is already completed (past travel date), flag this.
