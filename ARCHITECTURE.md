# Architecture: Pocker

This document describes the high-level architecture of the **Pocker** project — a Socket.IO-based Scrum Poker planning tool.

## Overview

Pocker is a real-time collaborative application for agile estimation. It provides:
-   **Dynamic Rooms:** Users can create rooms on-demand for specific sprints or teams.
-   **Real-time Voting:** Instant updates via WebSockets (Socket.IO).
-   **Estimation History:** Persistent storage for votes in PostgreSQL.
-   **YouTrack Integration:** Optional integration for updating story points.

---

## Technology Stack

-   **Runtime:** [Node.js](https://nodejs.org/) (18+)
-   **Communication:** [Socket.IO](https://socket.io/) (WebSockets with HTTP fallback)
-   **Storage:** [PostgreSQL](https://www.postgresql.org/) (via `pg` driver)
-   **Frontend:** Plain JavaScript, CSS, and HTML (served statically by the Node.js server)
-   **Containerization:** [Docker](https://www.docker.com/) and `docker-compose`

---

## Core Components

The application is structured into several key modules:

### 1. Server Core (`index.js`)
-   Entry point of the application.
-   Initializes the HTTP server and the Socket.IO instance.
-   Sets up dependencies: `RoomRegistry`, `EstimationHistoryStore`, and handlers.
-   Handles process initialization (connecting to PostgreSQL and starting the server).

### 2. Room Registry (`room-registry.js`)
-   **Responsibility:** Manages the in-memory state of active rooms.
-   **Logic:**
    -   Handles joining/leaving players.
    -   Tracks voting state (who voted, what is the current estimate).
    -   Manages "revealed" state (when votes are shown to everyone).
    -   Implements task management (switching between different items to estimate).
-   *Note: Currently, room states are stored in memory, meaning they are lost on server restart.*

### 3. Estimation History Store (`estimation-history-store.js`)
-   **Responsibility:** Interacts with the PostgreSQL database.
-   **Database Schema:** Manages the `estimation_history` table.
-   **Operations:**
    -   Deduplication of votes (updates existing votes if a user changes their mind).
    -   Retrieval of historical data for the `/history` page.
    -   Asynchronous recording of votes to ensure database latency doesn't block real-time communication.

### 4. HTTP Router (`src/routes/http.js`)
-   **Responsibility:** Handles traditional HTTP requests.
-   **Endpoints:**
    -   `/health`, `/version`: Health checks and metadata.
    -   `/public/*`: Serving static assets (CSS, JS, images).
    -   `/api/estimation-history`: Providing JSON data for the history view.
    -   `/` and `/{room-id}/`: Serving the main SPA (Single Page Application).

### 5. Socket Handlers (`src/handlers/socket.js`)
-   **Responsibility:** Implements the real-time business logic.
-   **Events:**
    -   `room:join`: Attaches a player to a room and sends the initial state.
    -   `vote:submit`: Processes a vote from a player.
    -   `vote:reveal`, `vote:reset`: Orchestrates the voting flow.
    -   `reaction:submit`: Propagates emojis between players.
    -   `task:update`: Updates the list of tasks or the current active task.

---

## Data Flow

### Voting Process
1.  **Frontend:** User clicks a card. Sends `vote:submit` via Socket.IO.
2.  **Socket Handler:** 
    -   Updates the player's vote in `RoomRegistry` (in-memory).
    -   Broadcasts the updated room state (masking actual votes if not revealed) to all clients in the room.
    -   Calls `EstimationHistoryStore.record()` to persist the vote in PostgreSQL.
3.  **Database:** PostgreSQL stores the vote in `estimation_history`.

### Room Discovery
-   Rooms are discovered via the URL. When a user visits `/{any-suffix}/`, the server serves `index.html`.
-   The frontend extracts the room ID from the URL and joins the corresponding Socket.IO room.

---

## Project Structure

```text
.
├── src/
│   ├── handlers/        # WebSocket logic
│   ├── routes/          # HTTP logic
│   └── utils/           # Shared helpers and logging
├── public/              # Client-side static assets (CSS, JS)
├── __tests__/           # Unit and integration tests
├── estimation-history-store.js  # DB persistence layer
├── room-registry.js             # Room state management
├── index.js                     # Application entry point
├── index.html                   # Main UI
└── history.html                 # History viewer UI
```
