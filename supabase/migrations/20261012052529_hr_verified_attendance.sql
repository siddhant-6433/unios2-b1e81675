-- keep-migration-version: restored production migration 20261012052529; preserve its applied version.
-- Only server-verified, employee-bound liveness sessions can record attendance.
CREATE TABLE IF NOT EXISTS public.hr_attendance_evidence(
 session_id text PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),capability_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT(now()+interval '10 minutes'),
 verified_at timestamptz,consumed_at timestamptz,face_score numeric,liveness_score numeric,selfie_url text);
ALTER TABLE hr_attendance_evidence ENABLE ROW LEVEL SECURITY;
GRANT ALL ON hr_attendance_evidence TO service_role;
REVOKE ALL ON hr_attendance_evidence FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON employee_attendance FROM authenticated;

CREATE OR REPLACE FUNCTION public.hr_record_punch(_user_id uuid,_action text,_session_id text DEFAULT NULL,
 _campus_id uuid DEFAULT NULL,_location_id uuid DEFAULT NULL,_lat double precision DEFAULT NULL,_lng double precision DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e employee_profiles; v hr_attendance_evidence; punch employee_attendance; d date; lat double precision; lng double precision; radius numeric; dist numeric;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT is_account_active(_user_id) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 SELECT * INTO e FROM employee_profiles WHERE user_id=_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Employee missing'; END IF;
 d:=(now() AT TIME ZONE e.employee_timezone)::date;
 IF _action='out' THEN
  SELECT * INTO punch FROM employee_attendance WHERE user_id=_user_id AND punch_out IS NULL ORDER BY punch_in DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No open punch'; END IF;
  UPDATE employee_attendance SET punch_out=now() WHERE id=punch.id RETURNING * INTO punch;
  RETURN jsonb_build_object('id',punch.id,'punch_out',punch.punch_out);
 END IF;
 IF _action<>'in' THEN RAISE EXCEPTION 'Invalid punch action'; END IF;
 SELECT * INTO v FROM hr_attendance_evidence WHERE session_id=_session_id AND user_id=_user_id FOR UPDATE;
 IF NOT FOUND OR v.verified_at IS NULL OR v.consumed_at IS NOT NULL OR v.expires_at<=now() THEN RAISE EXCEPTION 'Fresh verified liveness required'; END IF;
 IF _lat IS NULL OR _lng IS NULL OR _lat NOT BETWEEN -90 AND 90 OR _lng NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'Invalid coordinates'; END IF;
 IF _campus_id IS NOT NULL AND _location_id IS NULL THEN
  SELECT latitude,longitude,geofence_radius_meters INTO lat,lng,radius FROM campuses WHERE id=_campus_id;
 ELSIF _location_id IS NOT NULL AND _campus_id IS NULL THEN
  SELECT latitude,longitude,radius_meters INTO lat,lng,radius FROM geofence_locations WHERE id=_location_id AND is_active;
 ELSE RAISE EXCEPTION 'Choose one configured attendance location'; END IF;
 IF lat IS NULL OR lng IS NULL OR radius IS NULL OR radius<=0 THEN RAISE EXCEPTION 'Geofence not configured'; END IF;
 dist:=6371000*2*asin(sqrt(LEAST(1,power(sin(radians(_lat-lat)/2),2)+cos(radians(lat))*cos(radians(_lat))*power(sin(radians(_lng-lng)/2),2))));
 IF dist>radius THEN RAISE EXCEPTION 'Outside attendance geofence'; END IF;
 IF EXISTS(SELECT 1 FROM employee_attendance WHERE user_id=_user_id AND punch_out IS NULL) THEN RAISE EXCEPTION 'Already punched in'; END IF;
 INSERT INTO employee_attendance(user_id,date,punch_in,campus_id,geofence_location_id,location_lat,location_lng,face_match_score,face_match_result,liveness_score,selfie_url)
 VALUES(_user_id,d,now(),_campus_id,_location_id,_lat,_lng,v.face_score,'match',v.liveness_score,v.selfie_url) RETURNING * INTO punch;
 UPDATE hr_attendance_evidence SET consumed_at=now() WHERE session_id=v.session_id;
 RETURN jsonb_build_object('id',punch.id,'punch_in',punch.punch_in);
END $$;
REVOKE ALL ON FUNCTION hr_record_punch(uuid,text,text,uuid,uuid,double precision,double precision) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hr_record_punch(uuid,text,text,uuid,uuid,double precision,double precision) TO service_role;

CREATE OR REPLACE FUNCTION public.hr_guard_face_registration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.role()='service_role' OR public.has_permission(auth.uid(),'hr:attendance_edit') THEN RETURN NEW; END IF;
 IF NEW.user_id IS DISTINCT FROM auth.uid() OR NEW.status<>'pending' OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL THEN RAISE EXCEPTION 'Face registration requires HR approval'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hr_guard_face_registration ON public.employee_face_registrations;
CREATE TRIGGER hr_guard_face_registration BEFORE INSERT OR UPDATE ON employee_face_registrations FOR EACH ROW EXECUTE FUNCTION hr_guard_face_registration();
