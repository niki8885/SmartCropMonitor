-- ============================================================================
-- Migration: de-duplicate weather_metrics and add the missing unique constraint
-- ============================================================================
--
-- Why this is needed
-- ------------------
-- The model (app/core/database.py :: WeatherMetrics) declares:
--     UniqueConstraint("location_id", "reference_weather_id",
--                      name="uq_weather_metrics_location_weather")
-- but the schema is created with Base.metadata.create_all(), which only
-- CREATEs missing tables — it never adds a constraint to a table that already
-- exists. As a result the constraint was never present in the database.
--
-- Without that DB-level guard, the application-level "upsert" in
-- weather_service._upsert_weather_metrics (SELECT-then-INSERT) raced under
-- overlapping sync jobs and inserted duplicate rows: up to ~177 metric rows
-- per (location_id, reference_weather_id). Those duplicates skewed the
-- /weather-stats aggregates and bloated the table.
--
-- This migration:
--   1. collapses duplicates, keeping the most recent row (MAX(id)) per key;
--   2. adds the unique constraint so ON CONFLICT works and dupes can't recur;
--   3. adds the declared-but-missing (location_id, window_end_date) index.
--
-- Apply once:
--   psql "$DATABASE_URL" -f backend/migrations/2026_06_weather_metrics_dedup_unique.sql
--
-- Safe to re-run (idempotent). Wrapped in a single transaction.
-- ============================================================================

BEGIN;

-- 1) Collapse duplicates: keep MAX(id) per (location_id, reference_weather_id).
--    Rows with reference_weather_id IS NULL are left untouched (a UNIQUE
--    constraint treats NULLs as distinct, so they neither conflict nor block).
--    Map every duplicate row to the survivor (MAX(id)) for its key.
CREATE TEMP TABLE _wm_dupes ON COMMIT DROP AS
SELECT m.id AS old_id, k.keep_id
FROM weather_metrics m
JOIN (
    SELECT location_id,
           reference_weather_id,
           MAX(id) AS keep_id
    FROM weather_metrics
    WHERE reference_weather_id IS NOT NULL
    GROUP BY location_id, reference_weather_id
    HAVING COUNT(*) > 1
) k
  ON k.location_id          = m.location_id
 AND k.reference_weather_id = m.reference_weather_id
WHERE m.reference_weather_id IS NOT NULL
  AND m.id <> k.keep_id;

--    Re-point FK references to the survivor before deleting. weather_metrics.id
--    is referenced only by biomass.reference_metrics_id (biomass_reference_metrics_id_fkey).
--    If other tables ever FK to weather_metrics.id, repoint them here too.
UPDATE biomass b
SET reference_metrics_id = d.keep_id
FROM _wm_dupes d
WHERE b.reference_metrics_id = d.old_id;

--    Now the duplicate rows are safe to delete.
DELETE FROM weather_metrics wm
USING _wm_dupes d
WHERE wm.id = d.old_id;

-- 2) Add the unique constraint (idempotent — skip if already present).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_weather_metrics_location_weather'
          AND conrelid = 'weather_metrics'::regclass
    ) THEN
        ALTER TABLE weather_metrics
            ADD CONSTRAINT uq_weather_metrics_location_weather
            UNIQUE (location_id, reference_weather_id);
    END IF;
END$$;

-- 3) Declared-but-missing composite index used by the stats/window queries.
CREATE INDEX IF NOT EXISTS ix_weather_metrics_location_window
    ON weather_metrics (location_id, window_end_date);

COMMIT;
