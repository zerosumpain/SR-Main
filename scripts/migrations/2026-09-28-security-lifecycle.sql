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
-- A change that leaves every credential standing: the audit row alone, no
-- version bump, no revocation.
CREATE OR REPLACE FUNCTION note_person_access(person text, why text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO access_security_audit(email,reason) VALUES(lower(person),why);
END $$;
-- Did a row's access shrink? Groups and grants are jsonb arrays of names, so
-- "nothing was taken away" is set containment of the old in the new. A legacy
-- role ('member', 'household') implied a grant the row does not spell out, so
-- its change is read as a narrowing — the safe reading, for the few old rows.
CREATE OR REPLACE FUNCTION access_narrowed(old_groups jsonb, old_grants jsonb, old_role text,
                                           new_groups jsonb, new_grants jsonb, new_role text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT NOT (COALESCE(new_groups,'[]'::jsonb) @> COALESCE(old_groups,'[]'::jsonb))
      OR NOT (COALESCE(new_grants,'[]'::jsonb) @> COALESCE(old_grants,'[]'::jsonb))
      OR (old_role IS DISTINCT FROM new_role AND COALESCE(old_role,'guest') <> 'guest')
$$;
-- Only a NARROWING revokes (2026-10-20). Every phone re-derives what it may do
-- on each request from the row as it now stands, so widening it — approving
-- a request, adding a role, pairing a child on the owner's word — must leave
-- the phones that were working, working; revoking them on every write is
-- what dropped an approved phone back to the start on 2026-10-19. Removal, a
-- change of address and anything taken away still revoke, as before, and a
-- remove/re-add is still two versions apart because the removal bumped it.
CREATE OR REPLACE FUNCTION invalidate_user_access_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    PERFORM invalidate_person_access(OLD.email,'account-removed');
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' THEN
    PERFORM note_person_access(NEW.email,'account-added');
    RETURN NEW;
  END IF;
  IF (OLD.email,OLD.groups,OLD.grants,OLD.role) IS NOT DISTINCT FROM
     (NEW.email,NEW.groups,NEW.grants,NEW.role) THEN RETURN NEW; END IF;
  IF OLD.email<>NEW.email THEN
    PERFORM invalidate_person_access(OLD.email,'address-changed');
    PERFORM invalidate_person_access(NEW.email,'access-changed');
    RETURN NEW;
  END IF;
  IF access_narrowed(OLD.groups,OLD.grants,OLD.role,NEW.groups,NEW.grants,NEW.role) THEN
    PERFORM invalidate_person_access(NEW.email,'access-narrowed');
  ELSE
    PERFORM note_person_access(NEW.email,'access-widened');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS security_user_access ON allowed_user;
CREATE TRIGGER security_user_access AFTER INSERT OR UPDATE OR DELETE ON allowed_user
  FOR EACH ROW EXECUTE FUNCTION invalidate_user_access_trigger();
-- A group's grants, likewise: more for its members leaves their phones alone;
-- less, or the group going, revokes every member's.
CREATE OR REPLACE FUNCTION invalidate_group_access_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE person record; widened boolean;
BEGIN
  IF TG_OP='UPDATE' AND OLD.grants IS NOT DISTINCT FROM NEW.grants THEN RETURN NEW; END IF;
  widened := TG_OP='UPDATE' AND (COALESCE(NEW.grants,'[]'::jsonb) @> COALESCE(OLD.grants,'[]'::jsonb));
  FOR person IN SELECT email FROM allowed_user WHERE groups ? OLD.id LOOP
    IF widened THEN PERFORM note_person_access(person.email,'group-widened');
    ELSE PERFORM invalidate_person_access(person.email,'group-changed'); END IF;
  END LOOP;
  IF TG_OP='UPDATE' THEN RETURN NEW; END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS security_group_access ON access_group;
CREATE TRIGGER security_group_access BEFORE UPDATE OR DELETE ON access_group
  FOR EACH ROW EXECUTE FUNCTION invalidate_group_access_trigger();
COMMIT;
