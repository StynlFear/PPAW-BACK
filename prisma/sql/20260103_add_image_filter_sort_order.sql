-- Add stable ordering for multiple filters applied to the same image version.

ALTER TABLE image_filters
ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;

-- Backfill ordering for any existing rows.
WITH ranked AS (
  SELECT
    image_version_id,
    filter_id,
    (row_number() OVER (
      PARTITION BY image_version_id
      ORDER BY applied_at ASC NULLS LAST, filter_id ASC
    ) - 1) AS rn
  FROM image_filters
)
UPDATE image_filters f
SET sort_order = r.rn
FROM ranked r
WHERE f.image_version_id = r.image_version_id
  AND f.filter_id = r.filter_id;

CREATE INDEX IF NOT EXISTS image_filters_image_version_id_sort_order_idx
  ON image_filters (image_version_id, sort_order);
