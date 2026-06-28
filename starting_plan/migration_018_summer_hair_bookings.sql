-- Summer Hair bookings (July 3 special event)
-- Apply via Supabase SQL Editor before deploying

CREATE TABLE IF NOT EXISTS summer_hair_bookings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  time_slot text NOT NULL,
  services jsonb NOT NULL DEFAULT '[]',
  party_size integer NOT NULL DEFAULT 1,
  notes text,
  status text NOT NULL DEFAULT 'confirmed',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Only one confirmed booking per time slot
CREATE UNIQUE INDEX IF NOT EXISTS idx_summer_hair_slot_confirmed
  ON summer_hair_bookings (time_slot)
  WHERE status = 'confirmed';

-- RLS: service role has full access (app uses service key server-side)
ALTER TABLE summer_hair_bookings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'summer_hair_bookings' AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access" ON summer_hair_bookings
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
