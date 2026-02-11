# Travel Support Agent - Workflow Graph

This agent handles customer support inquiries for a travel agency.

```mermaid
graph TD
    start(("START")) --> intake["Intake"]
    intake --> classify{"Classify Intent"}

    classify -->|"new_booking"| new_booking["New Booking"]
    classify -->|"modify_booking"| modify_booking["Modify Booking"]
    classify -->|"cancel_booking"| cancel_booking["Cancel Booking"]
    classify -->|"general_info"| general_info["General Information"]
    classify -->|"complaint"| handle_complaint["Handle Complaint"]

    new_booking --> confirm["Confirm Action"]
    modify_booking --> confirm
    cancel_booking --> confirm
    general_info --> confirm
    handle_complaint -->|"resolved"| confirm
    handle_complaint -->|"escalate"| escalate["Escalate to Human"]

    confirm --> done(("END"))
    escalate --> done
```

## Flow Description

1. **Intake**: Greet customer and gather initial inquiry
2. **Classify**: Determine the type of request (new booking, modification, cancellation, info, or complaint)
3. **Route to appropriate handler**:
   - **New Booking**: Help customer book flights, hotels, packages
   - **Modify Booking**: Change dates, passengers, destinations
   - **Cancel Booking**: Process cancellations and refunds
   - **General Info**: Answer questions about destinations, policies, travel requirements
   - **Handle Complaint**: Address issues, may escalate to human agent
4. **Confirm**: Summarize action taken and confirm with customer
5. **End**: Close the interaction gracefully
