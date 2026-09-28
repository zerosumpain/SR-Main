BEGIN;
ALTER TABLE native_credentials ADD COLUMN IF NOT EXISTS notification_details boolean NOT NULL DEFAULT false;
ALTER TABLE native_credentials ADD COLUMN IF NOT EXISTS live_activity_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS companion_access_version (
  email text PRIMARY KEY, version bigint NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS access_security_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(), email text NOT NULL, reason text NOT NULL
);
CREATE TABLE IF NOT EXISTS companion_privacy_receipt (
  job_id text PRIMARY KEY, completed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS companion_deletion_floor (
  email text PRIMARY KEY, subject text, deleted_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS companion_deletion_floor_subject_idx ON companion_deletion_floor(subject);
ALTER TABLE daydream_trail ADD COLUMN IF NOT EXISTS companion_received_at timestamptz;

-- A writer holding an old fetched page must not repopulate a deleted copy.
-- The same transaction locks are taken by the deletion consumer, so a write
-- either precedes (and is removed by) deletion, or sees its committed floor.
CREATE OR REPLACE FUNCTION guard_companion_deletion_floor()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cutoff timestamptz; observed timestamptz; person text;
BEGIN
  IF TG_TABLE_NAME IN ('family_steps_day','family_steps_event') THEN
    person:=NEW.email;
    IF TG_TABLE_NAME='family_steps_day' THEN observed:=NEW.checked_at;
    ELSE observed:=NEW.at; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('companion-privacy-email:'||person));
    SELECT deleted_at INTO cutoff FROM companion_deletion_floor WHERE email=person;
  ELSE
    IF TG_TABLE_NAME='daydream_trail' THEN
      IF NEW.source<>'companion' THEN RETURN NEW; END IF;
    END IF;
    person:=NEW.subject;
    PERFORM pg_advisory_xact_lock(hashtext('companion-privacy-subject:'||person));
    SELECT max(deleted_at) INTO cutoff FROM companion_deletion_floor WHERE subject=person;
    IF TG_TABLE_NAME='daydream_trail' THEN observed:=NEW.companion_received_at;
    ELSIF TG_TABLE_NAME='household_event' THEN observed:=NEW.at; cutoff:=cutoff+interval '5 minutes';
    ELSE observed:=NEW.started_at; cutoff:=cutoff+interval '5 minutes'; END IF;
  END IF;
  IF cutoff IS NOT NULL AND (observed IS NULL OR observed<=cutoff) THEN RETURN NULL; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS companion_privacy_floor ON daydream_trail;
CREATE TRIGGER companion_privacy_floor BEFORE INSERT OR UPDATE ON daydream_trail
  FOR EACH ROW EXECUTE FUNCTION guard_companion_deletion_floor();
DROP TRIGGER IF EXISTS companion_privacy_floor ON household_event;
CREATE TRIGGER companion_privacy_floor BEFORE INSERT OR UPDATE ON household_event
  FOR EACH ROW EXECUTE FUNCTION guard_companion_deletion_floor();
DROP TRIGGER IF EXISTS companion_privacy_floor ON household_journey;
CREATE TRIGGER companion_privacy_floor BEFORE INSERT OR UPDATE ON household_journey
  FOR EACH ROW EXECUTE FUNCTION guard_companion_deletion_floor();
DROP TRIGGER IF EXISTS companion_privacy_floor ON family_steps_day;
CREATE TRIGGER companion_privacy_floor BEFORE INSERT OR UPDATE ON family_steps_day
  FOR EACH ROW EXECUTE FUNCTION guard_companion_deletion_floor();
DROP TRIGGER IF EXISTS companion_privacy_floor ON family_steps_event;
CREATE TRIGGER companion_privacy_floor BEFORE INSERT OR UPDATE ON family_steps_event
  FOR EACH ROW EXECUTE FUNCTION guard_companion_deletion_floor();

-- A version survives account deletion/re-creation. Even a remove/re-add
-- between two companion requests permanently invalidates the old credentials.
CREATE OR REPLACE FUNCTION invalidate_person_access(person text, why text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO companion_access_version(email) VALUES(lower(person))
    ON CONFLICT(email) DO UPDATE SET version=companion_access_version.version+1;
  INSERT INTO access_security_audit(email,reason) VALUES(lower(person),why);
  UPDATE native_credentials SET revoked_at=now(), apns_token=NULL,
    apns_token_at=NULL, la_start_token=NULL, la_start_token_at=NULL
    WHERE owner_email=lower(person) AND revoked_at IS NULL;
  DELETE FROM household_journey_viewer WHERE device_id IN
    (SELECT id FROM native_credentials WHERE owner_email=lower(person));
END $$;
CREATE OR REPLACE FUNCTION invalidate_user_access_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    PERFORM invalidate_person_access(OLD.email,'account-removed');
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF (OLD.email,OLD.groups,OLD.grants,OLD.role) IS NOT DISTINCT FROM
       (NEW.email,NEW.groups,NEW.grants,NEW.role) THEN RETURN NEW; END IF;
    IF OLD.email<>NEW.email THEN PERFORM invalidate_person_access(OLD.email,'address-changed'); END IF;
  END IF;
  PERFORM invalidate_person_access(NEW.email,'access-changed');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS security_user_access ON allowed_user;
CREATE TRIGGER security_user_access AFTER INSERT OR UPDATE OR DELETE ON allowed_user
  FOR EACH ROW EXECUTE FUNCTION invalidate_user_access_trigger();
CREATE OR REPLACE FUNCTION invalidate_group_access_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE person record;
BEGIN
  IF TG_OP='UPDATE' AND OLD.grants IS NOT DISTINCT FROM NEW.grants THEN RETURN NEW; END IF;
  FOR person IN SELECT email FROM allowed_user WHERE groups ? OLD.id LOOP
    PERFORM invalidate_person_access(person.email,'group-changed');
  END LOOP;
  IF TG_OP='UPDATE' THEN RETURN NEW; END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS security_group_access ON access_group;
CREATE TRIGGER security_group_access BEFORE UPDATE OR DELETE ON access_group
  FOR EACH ROW EXECUTE FUNCTION invalidate_group_access_trigger();
COMMIT;
