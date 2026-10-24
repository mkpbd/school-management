-- 0044_hst_mess: hostel mess - weekly menu, diets, meal opt-outs before a cutoff, kitchen headcount and servings.
-- Run as sms_owner. Grants come from the hst default privileges (0037).

ALTER TABLE hst.allocation
  ADD COLUMN diet      text NOT NULL DEFAULT 'regular'
                       CHECK (diet IN ('regular','vegetarian','no_beef','diabetic','gluten_free','other')),
  ADD COLUMN diet_note text;

CREATE TABLE hst.mess_menu (                       -- the weekly cycle of a hostel
  org_id      uuid NOT NULL,
  campus_id   uuid NOT NULL,
  hostel_id   uuid NOT NULL REFERENCES hst.hostel(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),   -- 0 = Sunday
  meal        text NOT NULL CHECK (meal IN ('breakfast','lunch','snacks','dinner')),
  items       text NOT NULL,
  items_bn    text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid DEFAULT core.current_user_id(),
  PRIMARY KEY (hostel_id, day_of_week, meal)
);

CREATE TABLE hst.meal_opt_out (                    -- a resident will not eat this meal (home, outing, fasting)
  org_id       uuid NOT NULL,
  campus_id    uuid NOT NULL,
  hostel_id    uuid NOT NULL REFERENCES hst.hostel(id),
  student_id   uuid NOT NULL REFERENCES sis.student(id),
  meal_date    date NOT NULL,
  meal         text NOT NULL CHECK (meal IN ('breakfast','lunch','snacks','dinner')),
  reason       text,
  requested_by uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, meal_date, meal)
);
CREATE INDEX ix_hst_opt_out_hostel ON hst.meal_opt_out (hostel_id, meal_date);

CREATE TABLE hst.meal_service (                    -- what the kitchen served against the headcount (waste control)
  org_id      uuid NOT NULL,
  campus_id   uuid NOT NULL,
  hostel_id   uuid NOT NULL REFERENCES hst.hostel(id),
  meal_date   date NOT NULL,
  meal        text NOT NULL CHECK (meal IN ('breakfast','lunch','snacks','dinner')),
  expected    smallint NOT NULL CHECK (expected >= 0),
  served      smallint NOT NULL CHECK (served >= 0),
  note        text,
  recorded_by uuid,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hostel_id, meal_date, meal)
);

CALL core.enable_campus_rls('hst.mess_menu');
CALL core.enable_campus_rls('hst.meal_opt_out');
CALL core.enable_campus_rls('hst.meal_service');
CALL core.enable_audit('hst.meal_opt_out');

COMMENT ON TABLE hst.mess_menu IS 'Weekly mess menu of a hostel (English / Bangla). [hostel mess]';
COMMENT ON TABLE hst.meal_opt_out IS 'Meals a resident will skip, requested before the cutoff (guardian, student or warden).';
COMMENT ON TABLE hst.meal_service IS 'Meals served against the expected headcount, per hostel, date and meal.';
