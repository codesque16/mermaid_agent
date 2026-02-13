# Airline Domain — Policy, Flows & Tool Guide (Mermaid)

Reference time: **2024-05-15 15:00:00 EST**.

This document summarizes the airline agent policy, decision logic, and **which tool to use when**. It is derived from `policy.md`, `data_model.py`, `environment.py`, and `tools.py`.

---

## 1. High-level intent routing

```mermaid
flowchart TB
    subgraph INTENT["User intent"]
        A[Incoming request]
    end

    A --> B{Intent?}
    B -->|Book new flight| BOOK[→ Book flow]
    B -->|Modify reservation| MOD[→ Modify flow]
    B -->|Cancel reservation| CANC[→ Cancel flow]
    B -->|Refund / Compensation| REF[→ Refunds & compensation]
    B -->|Human agent / out of scope| TRANS[→ Transfer flow]
    B -->|Info only: airports, flights, user, reservation| READ[→ Read-only tools]

    BOOK --> T_BOOK[Tools: list_all_airports, search_*_flight, get_user_details, calculate, book_reservation]
    MOD --> T_MOD[Tools: get_reservation_details, get_flight_status, update_reservation_*, calculate]
    CANC --> T_CANC[Tools: get_reservation_details, get_flight_status, cancel_reservation or transfer]
    REF --> T_REF[Tools: get_reservation_details, send_certificate]
    TRANS --> T_TRANS[Tool: transfer_to_human_agents]
    READ --> T_READ[Tools: list_all_airports, search_*_flight, get_user_details, get_reservation_details, get_flight_status]
```

**Golden rules (all flows):**
- One tool call at a time; no tool call and free-text reply in the same turn.
- Before any **write** that updates the booking DB (book, modify, baggage, cabin, passenger info): list action details and get **explicit user confirmation (yes)**.
- Deny requests that violate policy. Transfer only when the request cannot be handled within scope.

---

## 2. Domain entities (data model summary)

```mermaid
erDiagram
    USER ||--o{ RESERVATION : has
    USER {
        string user_id PK
        Name name
        Address address
        string email
        string dob
        Dict payment_methods
        List saved_passengers
        Literal membership
        List reservations
    }

    FLIGHT {
        string flight_number PK
        string origin
        string destination
        string scheduled_departure_time_est
        string scheduled_arrival_time_est
        Dict dates
    }

    FLIGHT_DATE_STATUS {
        string status
        object available_seats
        object prices
        string estimated_times
        string actual_times
    }

    RESERVATION ||--|{ RESERVATION_FLIGHT : contains
    RESERVATION ||--|{ PASSENGER : has
    RESERVATION {
        string reservation_id PK
        string user_id FK
        string origin
        string destination
        Literal flight_type
        Literal cabin
        List flights
        List passengers
        List payment_history
        string created_at
        int total_baggages
        int nonfree_baggages
        Literal insurance
        Literal status
    }

    FLIGHT ||--o{ FLIGHT_DATE_STATUS : per_date
```

- **Cabin:** `basic_economy` is distinct from `economy`.
- **Payment:** At most 1 travel certificate, 1 credit card, up to 3 gift cards per reservation; all must be in user profile.
- **Flight status (per date):** Only `available` is bookable; `on time` / `delayed` / `flying` are not.

---

## 3. Tool inventory and when to use each

```mermaid
flowchart LR
    subgraph READ["READ (no DB change)"]
        list_all_airports
        search_direct_flight
        search_onestop_flight
        get_user_details
        get_reservation_details
        get_flight_status
    end

    subgraph WRITE["WRITE (DB change)"]
        book_reservation
        cancel_reservation
        update_reservation_flights
        update_reservation_baggages
        update_reservation_passengers
        send_certificate
    end

    subgraph OTHER["OTHER"]
        calculate
        transfer_to_human_agents
    end
```

| Tool | When to use |
|------|-------------|
| **list_all_airports** | User asks for airports / city ↔ IATA (e.g. JFK, SFO). |
| **search_direct_flight** | Need direct options for origin, destination, date. |
| **search_onestop_flight** | Need one-stop options for origin, destination, date. |
| **get_user_details** | Need user_id, profile, payment methods, membership, reservations (e.g. to book or find reservation_id). |
| **get_reservation_details** | Need full reservation (flights, cabin, passengers, baggage, insurance, status) for modify/cancel/compensation. |
| **get_flight_status** | Check if a flight is available / delayed / flying / landed / cancelled (for modify/cancel/compensation rules). |
| **calculate** | Any arithmetic (baggage fee, insurance, price difference, compensation amount). |
| **book_reservation** | User confirmed booking: user_id, origin, destination, flight_type, cabin, flights, passengers, payment_methods, total_baggages, nonfree_baggages, insurance. |
| **cancel_reservation** | User confirmed cancellation and policy allows it (see Cancel flow). |
| **update_reservation_flights** | Change flights and/or cabin (same origin, destination, trip type; not basic economy for flight change). Need reservation_id, cabin, full flights list, payment_id for delta. |
| **update_reservation_baggages** | Add bags only (cannot remove). Need reservation_id, total_baggages, nonfree_baggages, payment_id. |
| **update_reservation_passengers** | Change passenger details only; **number of passengers must not change**. |
| **send_certificate** | After confirming facts and policy: offer compensation certificate ($100 or $50 × passengers) when allowed. |
| **transfer_to_human_agents** | Only when user explicitly asks for human or request cannot be fulfilled within policy; then send: "YOU ARE BEING TRANSFERRED TO A HUMAN AGENT. PLEASE HOLD ON." |

---

## 4. Book flow

```mermaid
flowchart TB
    START[User wants to book] --> GET_UID[Obtain user_id]
    GET_UID --> GET_ROUTE[Ask: trip type, origin, destination]
    GET_ROUTE --> USE_LIST[list_all_airports if needed for cities/codes]
    USE_LIST --> USE_SEARCH[search_direct_flight or search_onestop_flight]
    USE_SEARCH --> GET_USER[get_user_details for payment methods & membership]
    GET_USER --> COLLECT[Cabin same for all flights\nPassengers: first name, last name, DOB\nMax 5 passengers]
    COLLECT --> PAY[Payment: ≤1 cert, ≤1 credit card, ≤3 gift cards\nAll from user profile]
    COLLECT --> BAG[Checked bags: by membership + cabin\nExtra bag = $50]
    COLLECT --> INS[Ask: travel insurance? $30/passenger]
    PAY --> CONFIRM[List actions and get explicit yes]
    BAG --> CONFIRM
    INS --> CONFIRM
    CONFIRM --> BOOK_CALL[book_reservation]
    BOOK_CALL --> DONE[Booking complete]
```

**When to use which tool in Book:**
- **list_all_airports** — When you need to map city names to IATA codes (or vice versa).
- **search_direct_flight(origin, destination, date)** — When user wants direct flights only.
- **search_onestop_flight(origin, destination, date)** — When user is fine with one stop.
- **get_user_details(user_id)** — To get payment methods, membership (for bag allowance), and to validate payment IDs.
- **calculate(expression)** — For total price, baggage fee (50 × nonfree_baggages), insurance (30 × passengers).
- **book_reservation(...)** — Only after collecting all required fields and **explicit user confirmation**.

---

## 5. Modify flow

```mermaid
flowchart TB
    START[User wants to modify] --> GET_IDS[Obtain user_id and reservation_id]
    GET_IDS --> NO_RES_ID{User knows reservation_id?}
    NO_RES_ID -->|No| LIST_RES[get_user_details to list reservations]
    LIST_RES --> GET_IDS
    NO_RES_ID -->|Yes| GET_RES[get_reservation_details]
    GET_RES --> WHAT{What to change?}

    WHAT -->|Change flights| CHECK_BE[Basic economy?]
    CHECK_BE -->|Yes| DENY_BE[Cannot modify flights]
    CHECK_BE -->|No| RULES_F[Same origin, destination, trip type\nSome segments can stay, price not updated]
    RULES_F --> PAY_F[User provides 1 gift card or credit card for payment/refund]
    PAY_F --> CONFIRM_F[Confirm then update_reservation_flights]

    WHAT -->|Change cabin| FLOWN{Any flight already flown?}
    FLOWN -->|Yes| DENY_C[Cannot change cabin]
    FLOWN -->|No| RULES_C[Same cabin for all flights\nPay difference or get refund]
    RULES_C --> CONFIRM_C[Confirm then update_reservation_flights with new cabin]

    WHAT -->|Add bags only| BAG_RULE[Cannot remove bags]
    BAG_RULE --> CONFIRM_B[Confirm then update_reservation_baggages]

    WHAT -->|Change passenger details| PASS_RULE[Same number of passengers only]
    PASS_RULE --> CONFIRM_P[Confirm then update_reservation_passengers]

    WHAT -->|Add insurance| DENY_I[Cannot add insurance after booking]
```

**When to use which tool in Modify:**
- **get_reservation_details(reservation_id)** — First for any modify; also to check cabin, flights, passengers, baggage, insurance.
- **get_flight_status(flight_number, date)** — To see if any segment is already flown (for cabin change) or for general status.
- **get_user_details(user_id)** — To list reservations if user doesn’t know reservation_id; or to validate payment_id for updates.
- **update_reservation_flights(reservation_id, cabin, flights, payment_id)** — For changing flights and/or cabin (full new flight list; certificate not allowed for update).
- **update_reservation_baggages(reservation_id, total_baggages, nonfree_baggages, payment_id)** — Only to add bags.
- **update_reservation_passengers(reservation_id, passengers)** — When editing names/DOB only; passenger count must match.
- **calculate** — For price deltas, baggage fees.

---

## 6. Cancel flow

```mermaid
flowchart TB
    START[User wants to cancel] --> GET_IDS[Obtain user_id and reservation_id]
    GET_IDS --> GET_RES[get_reservation_details]
    GET_RES --> REASON[Obtain reason: change of plan, airline cancelled, or other]
    REASON --> FLOWN{Any portion already flown?}
    FLOWN -->|Yes| TRANS[Transfer to human]
    FLOWN -->|No| ALLOWED{Cancel allowed if any?}
    ALLOWED -->|Booked &lt; 24h ago| YES
    ALLOWED -->|Airline cancelled flight| YES
    ALLOWED -->|Business cabin| YES
    ALLOWED -->|Has insurance + reason covered| YES
    ALLOWED -->|None of above| NO[Deny or transfer]
    YES --> CONFIRM[Confirm then cancel_reservation]
    CONFIRM --> REFUND[Refund to original payment methods in 5–7 business days]
```

**When to use which tool in Cancel:**
- **get_reservation_details(reservation_id)** — To check created_at (24h), cabin, insurance, flights.
- **get_flight_status(flight_number, date)** — For each segment to see if any is flown (if any flown → transfer, do not cancel).
- **cancel_reservation(reservation_id)** — Only when rules are met and user has confirmed (API does not enforce rules; agent must).

---

## 7. Refunds and compensation flow

```mermaid
flowchart TB
    START[User asks for compensation/refund] --> ASKED{User explicitly asked?}
    ASKED -->|No| NO_OFFER[Do not proactively offer]
    ASKED -->|Yes| CONFIRM_FACTS[Confirm facts with get_reservation_details / get_flight_status]
    CONFIRM_FACTS --> ELIGIBLE{Eligible?}
    ELIGIBLE -->|Regular, no insurance, economy/basic_economy| DENY[Do not compensate]
    ELIGIBLE -->|Silver or Gold OR has insurance OR business| ALLOW[May offer certificate]
    ALLOW --> REASON{Reason?}
    REASON -->|Complaint: cancelled flights in reservation| CERT100[send_certificate: $100 × num passengers]
    REASON -->|Complaint: delayed + wants change/cancel| CHANGE_CANC[Change or cancel first, then send_certificate: $50 × num passengers]
    REASON -->|Any other reason| DENY_OTHER[Do not offer]
```

**When to use which tool:**
- **get_reservation_details** — To confirm membership, insurance, cabin, passengers, status.
- **get_flight_status** — To confirm cancelled/delayed and which segments.
- **send_certificate(user_id, amount)** — Only after confirming facts and eligibility; amount = 100 × or 50 × number of passengers as per policy.

---

## 8. Transfer flow

```mermaid
flowchart TB
    START[Transfer needed?] --> WHEN{When?}
    WHEN -->|User explicitly asks for human| DO_TRANS
    WHEN -->|Request cannot be solved within policy or tools| DO_TRANS
    WHEN -->|Otherwise| NO_TRANS[Do not transfer]
    DO_TRANS --> CALL[Call transfer_to_human_agents with summary]
    CALL --> MSG[Send transfer message to user]
```

**When to use:** **transfer_to_human_agents(summary)** only in the two cases above; then send the exact message.

---

## 9. Booking constraints (quick reference)

```mermaid
flowchart LR
    subgraph BOOK_LIMITS["Booking limits"]
        A[Max 5 passengers]
        B[Same cabin for all flights]
        C[Same flights for all passengers]
        D[Payment: ≤1 cert, ≤1 CC, ≤3 gift cards]
        E[All payment methods in user profile]
        F[No bags user does not need]
    end
```

**Free checked bags (by booking user membership):**

| Membership | basic_economy | economy | business |
|------------|--------------|---------|----------|
| regular    | 0            | 1       | 2        |
| silver     | 1            | 2       | 3        |
| gold       | 2            | 3       | 4        |

Extra bag = **$50**. Travel insurance = **$30 per passenger** (optional at booking only).

---

## 10. File and environment reference

| Asset | Role |
|-------|------|
| **policy.md** | Human-readable agent policy (source of truth for rules). |
| **data_model.py** | User, Flight, Reservation, FlightDateStatus, payment types, etc. |
| **environment.py** | Builds Environment with policy + AirlineTools(db). |
| **tools.py** | AirlineTools implementation (all tools above). |
| **utils.py** | Paths: AIRLINE_DB_PATH, AIRLINE_POLICY_PATH, AIRLINE_TASK_SET_PATH. |

This Mermaid document is a **companion** to `policy.md` and the code: it encapsulates the same logic and flows and specifies which tool to use in each situation.
