-- Auto punch-out function: closes any open attendance after shift + 30 min
-- Default shift: 9:30 AM - 6:30 PM (18:30 + 0:30 = 19:00 / 7:00 PM)
CREATE OR REPLACE FUNCTION auto_punch_out()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cutoff_time timestamptz;
  affected integer;
BEGIN
  -- Cutoff: today at 7:00 PM local time (shift end 6:30 PM + 30 min)
  cutoff_time := (CURRENT_DATE + interval '19 hours')::timestamptz;

  -- Only run if current time is past cutoff
  IF now() < cutoff_time THEN
    RETURN 0;
  END IF;

  -- Auto punch-out anyone still punched in today
  UPDATE employee_attendance
  SET punch_out = cutoff_time,
      notes = 'Auto punch-out (shift + 30 min)'
  WHERE date = CURRENT_DATE
    AND punch_out IS NULL
    AND punch_in IS NOT NULL;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- Also auto punch-out for yesterday (in case cron missed it)
-- Anyone punched in yesterday without punch_out
UPDATE employee_attendance
SET punch_out = (date + interval '19 hours')::timestamptz,
    notes = 'Auto punch-out (missed)'
WHERE punch_out IS NULL
  AND punch_in IS NOT NULL
  AND date < CURRENT_DATE;

-- Grant execute
GRANT EXECUTE ON FUNCTION auto_punch_out() TO authenticated;
GRANT EXECUTE ON FUNCTION auto_punch_out() TO service_role;
