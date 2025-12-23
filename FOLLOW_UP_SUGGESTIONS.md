# Follow-up Suggestions

These are optional changes that would likely improve reliability or fix edge cases, but need your confirmation before I proceed.

## Data and Time Handling
- Emit unix timestamps for all modes (including simulated/historical), so the frontend never has to infer dates from day offsets.
- Persist the simulation time zone and market hours in the backend payload so the frontend does not hardcode them.
- Add an exchange calendar (NYSE/US) to skip holidays and half-days, not just weekends.

## Market Data Quality
- Move the price jump guard to a shared validator so all market data sources and modes apply the same sanity checks.
- Add an audit log for price adjustments (store both raw and guarded prices for debugging).
- Expose MAX_PRICE_JUMP_PERCENT in the admin/config UI (or /api/config) for live tuning.

## Scheduler and Worker
- Split the hybrid scheduler into explicit phases (historical -> catch-up -> realtime), with a durable state machine.
- Persist the current simulation phase and last transition time in the snapshot for safer restarts.
- Add jittered backoff when Yahoo throttles to reduce retry spikes.

## Frontend Charting
- Add a thin sampling layer for large histories (bucket by minute/hour), keeping tooltips accurate.
- Provide a user toggle for showing after-hours data or only market hours.
- Add a legend toggle for benchmarks to reduce clutter when many agents are present.

## Testing and Observability
- Add unit tests around time normalization and hybrid transitions.
- Add a backend integration test that replays a week of data to validate chart timestamps and no weekend leakage.
- Add a frontend story/test for the chart that includes gaps and mixed timestamp formats.
