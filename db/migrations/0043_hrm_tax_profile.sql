-- 0043_hrm_tax_profile: Finance Act 2026 personal facts for salary TDS.
-- Run as sms_owner.
--   disabled_children: the tax-free threshold rises per disabled child (one parent claims it)
--   new_taxpayer:      first-time taxpayers pay a lower minimum tax
ALTER TABLE hrm.staff_tax_profile
  ADD COLUMN disabled_children smallint NOT NULL DEFAULT 0 CHECK (disabled_children BETWEEN 0 AND 10),
  ADD COLUMN new_taxpayer      boolean  NOT NULL DEFAULT false;
