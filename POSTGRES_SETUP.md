# Postgres Persistence Setup Guide

This guide walks through provisioning a Postgres database on Render and wiring it into the LLM Finance Arena backend so simulation state survives restarts and multi-day runs.

## Why move to Postgres?

- **Resilience:** Snapshots are stored outside the backend container, so restarts or redeploys pick up exactly where the engine left off.
- **History:** Every intraday save is archived in `simulation_snapshot_history`, enabling analytics across multiple trading days without replaying prior sessions.
- **Shared storage:** Multiple backend instances (preview vs. production) can point at isolated namespaces inside the same database.

## Prerequisites

- Existing Render Web Service running the backend (see [DEPLOYMENT.md](./DEPLOYMENT.md)).
- Access to create Render Postgres instances (Starter tier is sufficient).
- `git` access to update the repo with the new environment variables.

## Step 1 – Provision Render Postgres

1. Sign in to [Render](https://dashboard.render.com/).
2. Click **New** → **PostgreSQL**.
3. Choose a name (e.g., `llm-finance-arena-db`) and select the **Starter** plan.
4. Click **Create Database**. Wait for Render to finish provisioning (status turns to `Available`).
5. From the database dashboard, copy the `Internal Database URL` or `External Database URL` (both work—the backend accepts either).

> **Tip:** Render manages SSL for you. Keep the `?sslmode=require` suffix; the backend enables TLS automatically unless you override `POSTGRES_SSL`.

## Step 2 – Configure the Backend Service

1. Open your backend Web Service on Render.
2. Click **Environment** → **Add Environment Variable**.
3. Set the following variables (adjust values as needed):

   | Key | Value | Notes |
   | --- | --- | --- |
   | `PERSISTENCE_DRIVER` | `postgres` | Switches the backend from file storage to Postgres. |
   | `DATABASE_URL` | `<paste from Render Postgres>` | You can also use `POSTGRES_URL`; both are recognized. |
   | `POSTGRES_SSL` | `true` *(default)* | Leave enabled on Render. Set to `false` only for local Postgres without TLS. |
   | `POSTGRES_NAMESPACE` | `production` *(optional)* | Logical partition key—use different values for staging vs. production. |
   | `POSTGRES_SNAPSHOT_ID` | `current` *(optional)* | Row identifier for the "latest snapshot" entry. Change if you run multiple engines in the same namespace. |
   | `SNAPSHOT_AUTOSAVE_INTERVAL_MS` | `900000` *(optional)* | 15-minute autosave cadence; adjust for your retention needs. |

4. Click **Save Changes**, then redeploy (Manual Deploy → Clear build cache & deploy).

During startup the backend will:

- Establish a connection to Postgres using the provided URL.
- Create/verify two tables (`simulation_snapshots`, `simulation_snapshot_history`).
- Load the most recent snapshot for the configured namespace.

Logs will confirm the connection and highlight any migration issues. Errors typically stem from invalid credentials or blocked SSL settings.

## Step 3 – Verify Persistence

1. Open the backend logs and look for entries similar to:

   ```text
   [INFO] [SIMULATION] Postgres persistence initialized {"driver":"postgres","namespace":"production","snapshotId":"current"}
   ```

2. Trigger a price tick (wait for the scheduler or use the UI). A follow-up log should read `Snapshot saved to persistence` with `driver: postgres`.
3. Restart the Render service. When it comes back online, `/api/simulation/state` should immediately return the previous snapshot instead of starting from day 0.

4. Optional: Inspect the tables directly using Render’s **Connect** tab or any Postgres client. You should see rows in:

   - `simulation_snapshots` – single row per namespace containing the latest JSON snapshot.
   - `simulation_snapshot_history` – one row per `(namespace, day, intraday_hour, mode)`.

## Local Development with Postgres

You can also test Postgres persistence locally:

1. Install Postgres (Docker is easiest: `docker run --name arena-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres`).
2. Set environment variables in `backend/.env`:

   ```env
   PERSISTENCE_DRIVER=postgres
   POSTGRES_URL=postgres://postgres:postgres@localhost:5432/postgres
   POSTGRES_SSL=false
   POSTGRES_NAMESPACE=dev
   ```

3. Start the backend (`npm run dev`). Tables are created automatically on first boot.

4. To revert to file storage, change `PERSISTENCE_DRIVER=file` and remove the Postgres variables.

## Resetting Data

- **From the UI / API:** `POST /api/simulation/reset` clears the active persistence target (file or Postgres) and restarts the season.
- **Manual cleanup:**
  - File driver – delete the snapshot path defined by `PERSIST_PATH`.
  - Postgres driver – run `DELETE FROM simulation_snapshots WHERE namespace = '<name>'; DELETE FROM simulation_snapshot_history WHERE namespace = '<name>';`.

## Troubleshooting

- **`Error loading snapshot from Postgres`** – Check connectivity/credentials and ensure the Render database is accessible from the backend service.
- **`Failed to clear snapshot for reset`** – The service may lack permission to delete the row; verify `POSTGRES_NAMESPACE` matches the data you’re trying to wipe.
- **SSL errors locally** – Set `POSTGRES_SSL=false` when connecting to a local Postgres instance without TLS.

Once configured, the backend no longer depends on container-local storage, making Render restarts and multi-day simulations safe.
