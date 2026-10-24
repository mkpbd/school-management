-- 0002_organisation_reference_data: one organisation with campuses, system roles + default permission matrix (§5.6),
-- grading schemes (Appendix A), exam types, fee heads, concession types, leave types, lookups, workflows,
-- notification rules, message templates and number sequences. Idempotent.
--   psql -v org_code=LIS -v org_name='Lighthouse International School' -f 0002_organisation_reference_data.sql
\encoding UTF8

\if :{?org_code} \else \set org_code LIS \endif
\if :{?org_name} \else \set org_name 'Lighthouse International School' \endif

INSERT INTO core.organisation (code, name_en, name_bn)
VALUES (:'org_code', :'org_name', 'লাইটহাউস ইন্টারন্যাশনাল স্কুল')
ON CONFLICT (code) DO NOTHING;

SELECT id AS org_id FROM core.organisation WHERE code = :'org_code' \gset
SELECT set_config('app.org_id', :'org_id', false), set_config('app.campus_ids', '*', false) \gset

-- Campuses -------------------------------------------------------------------------------------------
INSERT INTO core.campus (org_id, code, name_en, name_bn) VALUES
  (:'org_id', 'DHN', 'Dhanmondi Campus', 'ধানমন্ডি ক্যাম্পাস'),
  (:'org_id', 'GUL', 'Gulshan Campus',   'গুলশান ক্যাম্পাস'),
  (:'org_id', 'LAL', 'Lalmatia Campus',  'লালমাটিয়া ক্যাম্পাস')
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO core.org_module (org_id, module_code, enabled, enabled_at)
SELECT :'org_id', m, m = ANY ('{core,adm,sis,aca,att,lrn,exm,fee,hrm,com,prt,doc,web,bi}'), now()
  FROM unnest('{core,adm,sis,aca,att,lrn,exm,fee,acc,hrm,com,prt,trn,lib,inv,hlt,cca,sec,doc,web,bi}'::text[]) m
ON CONFLICT DO NOTHING;

-- System roles ----------------------------------------------------------------------------------------
INSERT INTO iam.role (org_id, code, name_en, name_bn, is_system, requires_mfa) VALUES
  (:'org_id','PRINCIPAL',        'Principal',               'অধ্যক্ষ',               true, true),
  (:'org_id','VICE_PRINCIPAL',   'Vice-Principal',          'উপাধ্যক্ষ',             true, true),
  (:'org_id','CAMPUS_HEAD',      'Campus Head',             'ক্যাম্পাস প্রধান',        true, true),
  (:'org_id','HEAD_OF_SECTION',  'Head of Section',         'সেকশন প্রধান',          true, false),
  (:'org_id','CLASS_TEACHER',    'Class Teacher',           'শ্রেণি শিক্ষক',          true, false),
  (:'org_id','SUBJECT_TEACHER',  'Subject Teacher',         'বিষয় শিক্ষক',           true, false),
  (:'org_id','EXAM_OFFICER',     'Exam Officer',            'পরীক্ষা কর্মকর্তা',       true, false),
  (:'org_id','ACADEMIC_COORDINATOR','Academic Coordinator','একাডেমিক সমন্বয়ক',     true, false),
  (:'org_id','ACCOUNTANT',       'Accountant',              'হিসাবরক্ষক',            true, true),
  (:'org_id','CASHIER',          'Cashier',                 'ক্যাশিয়ার',             true, false),
  (:'org_id','ADMISSION_OFFICER','Admission Officer',       'ভর্তি কর্মকর্তা',         true, false),
  (:'org_id','HR',               'HR Officer',              'মানবসম্পদ কর্মকর্তা',     true, true),
  (:'org_id','LIBRARIAN',        'Librarian',               'গ্রন্থাগারিক',           true, false),
  (:'org_id','TRANSPORT',        'Transport In-charge',     'পরিবহন দায়িত্বপ্রাপ্ত',   true, false),
  (:'org_id','DRIVER',           'Driver',                  'চালক',                  true, false),
  (:'org_id','WARDEN',           'Hostel Warden',           'হোস্টেল ওয়ার্ডেন',        true, false),
  (:'org_id','STORE_KEEPER',     'Store Keeper',            'স্টোর কিপার',           true, false),
  (:'org_id','NURSE',            'Nurse',                   'নার্স',                 true, false),
  (:'org_id','COUNSELLOR',       'Counsellor',              'কাউন্সেলর',             true, false),
  (:'org_id','FRONT_DESK',       'Front Desk / Security',   'অভ্যর্থনা / নিরাপত্তা',   true, false),
  (:'org_id','IT_ADMIN',         'IT Administrator',        'আইটি অ্যাডমিন',          true, true),
  (:'org_id','PARENT',           'Parent / Guardian',       'অভিভাবক',              true, false),
  (:'org_id','STUDENT',          'Student',                 'শিক্ষার্থী',             true, false),
  -- full access (every permission, organisation-wide): school owner / system administrator. Give it to very few
  -- people and turn on requires_mfa for production.
  (:'org_id','SUPER_ADMIN',      'System Administrator (full access)', 'সিস্টেম অ্যাডমিনিস্ট্রেটর (পূর্ণ অ্যাক্সেস)', true, false)
ON CONFLICT (org_id, code) DO NOTHING;

-- Default permission matrix (spec §5.6). Pattern rules: (role, LIKE pattern on permission code, data scope).
WITH rule(role_code, pattern, scope) AS (VALUES
  ('SUPER_ADMIN','%','org'),
  -- Principal / campus head: view + approve everywhere, export reports; settings approval
  ('PRINCIPAL','%.view','org'), ('PRINCIPAL','%.approve','org'), ('PRINCIPAL','%.export','org'),
  ('PRINCIPAL','com.notice.create','org'), ('PRINCIPAL','com.broadcast.create','org'),
  ('VICE_PRINCIPAL','%.view','org'), ('VICE_PRINCIPAL','%.approve','org'),
  ('CAMPUS_HEAD','%.view','campus'), ('CAMPUS_HEAD','%.approve','campus'), ('CAMPUS_HEAD','%.export','campus'),
  ('CAMPUS_HEAD','com.notice.create','campus'), ('CAMPUS_HEAD','com.broadcast.create','campus'),
  -- Head of section
  ('HEAD_OF_SECTION','sis.student.view','section'), ('HEAD_OF_SECTION','sis.student.edit','section'),
  ('HEAD_OF_SECTION','att.%','section'), ('HEAD_OF_SECTION','aca.%','section'),
  ('HEAD_OF_SECTION','exm.mark.%','section'), ('HEAD_OF_SECTION','exm.result.view','section'),
  ('HEAD_OF_SECTION','lrn.%','section'), ('HEAD_OF_SECTION','hlt.behaviour.%','section'),
  ('HEAD_OF_SECTION','com.notice.%','section'), ('HEAD_OF_SECTION','com.message.%','section'),
  ('HEAD_OF_SECTION','bi.dashboard.view','section'), ('HEAD_OF_SECTION','wf.approval.%','section'),
  -- Teachers
  ('CLASS_TEACHER','sis.student.view','own_classes'), ('CLASS_TEACHER','sis.guardian.view','own_classes'),
  ('CLASS_TEACHER','att.daily.%','own_classes'), ('CLASS_TEACHER','att.student_leave.%','own_classes'),
  ('CLASS_TEACHER','lrn.diary.%','own_classes'), ('CLASS_TEACHER','hlt.behaviour.create','own_classes'),
  ('CLASS_TEACHER','hlt.health.view','own_classes'), ('CLASS_TEACHER','com.message.%','own_classes'),
  ('CLASS_TEACHER','exm.result.view','own_classes'), ('CLASS_TEACHER','wf.approval.%','own_classes'),
  ('SUBJECT_TEACHER','sis.student.view','own_subjects'), ('SUBJECT_TEACHER','att.period.%','own_subjects'),
  ('SUBJECT_TEACHER','lrn.homework.%','own_subjects'), ('SUBJECT_TEACHER','lrn.resource.%','own_subjects'),
  ('SUBJECT_TEACHER','lrn.gradebook.view','own_subjects'), ('SUBJECT_TEACHER','lrn.gradebook.edit','own_subjects'),
  ('SUBJECT_TEACHER','lrn.lesson_plan.create','own_subjects'), ('SUBJECT_TEACHER','lrn.quiz.%','own_subjects'),
  ('SUBJECT_TEACHER','exm.mark.view','own_subjects'), ('SUBJECT_TEACHER','exm.mark.edit','own_subjects'),
  ('SUBJECT_TEACHER','aca.timetable.view','self'), ('SUBJECT_TEACHER','att.staff_leave.create','self'),
  ('SUBJECT_TEACHER','hrm.staff.view','self'), ('SUBJECT_TEACHER','com.message.%','own_subjects'),
  -- Academic coordinator (campus registrar): structure, timetable, students, enrolment, attendance oversight
  ('ACADEMIC_COORDINATOR','aca.%','campus'), ('ACADEMIC_COORDINATOR','sis.student.%','campus'),
  ('ACADEMIC_COORDINATOR','sis.guardian.%','campus'), ('ACADEMIC_COORDINATOR','sis.enrolment.%','campus'),
  ('ACADEMIC_COORDINATOR','sis.document.%','campus'), ('ACADEMIC_COORDINATOR','sis.promotion.view','campus'),
  ('ACADEMIC_COORDINATOR','sis.withdrawal.%','campus'), ('ACADEMIC_COORDINATOR','sis.id_card.create','campus'),
  ('ACADEMIC_COORDINATOR','att.daily.%','campus'), ('ACADEMIC_COORDINATOR','att.correction.%','campus'),
  ('ACADEMIC_COORDINATOR','cca.house.%','campus'), ('HEAD_OF_SECTION','cca.house.view','section'),
  ('CLASS_TEACHER','cca.house.view','own_classes'), ('ADMISSION_OFFICER','cca.house.view','campus'),
  ('ACADEMIC_COORDINATOR','att.period.%','campus'), ('CLASS_TEACHER','att.period.view','own_classes'),
  ('CLASS_TEACHER','att.correction.create','own_classes'), ('SUBJECT_TEACHER','att.correction.create','own_subjects'),
  ('ACADEMIC_COORDINATOR','att.student_leave.%','campus'), ('ACADEMIC_COORDINATOR','core.calendar.%','campus'),
  ('ACADEMIC_COORDINATOR','core.year.view','campus'), ('ACADEMIC_COORDINATOR','core.master.view','campus'),
  ('ACADEMIC_COORDINATOR','hrm.staff.view','campus'), ('ACADEMIC_COORDINATOR','exm.exam.view','campus'),
  ('ACADEMIC_COORDINATOR','com.notice.%','campus'), ('ACADEMIC_COORDINATOR','hrm.cpd.view','campus'),
  ('ACADEMIC_COORDINATOR','hrm.cpd.create','campus'),
  -- Exam office
  ('EXAM_OFFICER','exm.%','campus'), ('EXAM_OFFICER','sis.student.view','campus'), ('EXAM_OFFICER','doc.document.create','campus'),
  -- Accounts & cashier
  ('HEAD_OF_SECTION','acc.requisition.%','campus'), ('LIBRARIAN','acc.requisition.%','campus'),
  ('TRANSPORT','acc.requisition.%','campus'), ('IT_ADMIN','acc.requisition.%','campus'),
  ('ACCOUNTANT','fee.%','campus'), ('ACCOUNTANT','acc.%','campus'), ('ACCOUNTANT','inv.stock.view','campus'), ('ACCOUNTANT','sis.student.view','campus'),
  ('ACCOUNTANT','sis.guardian.view','campus'), ('ACCOUNTANT','hrm.payroll.view','campus'), ('ACCOUNTANT','hrm.payroll.export','campus'), ('ACCOUNTANT','bi.%','campus'),
  ('CASHIER','fee.invoice.view','campus'), ('CASHIER','fee.payment.view','campus'), ('CASHIER','fee.payment.create','campus'),
  ('CASHIER','fee.cash_session.view','campus'), ('CASHIER','fee.cash_session.create','campus'), ('CASHIER','sis.student.view','campus'),
  ('CASHIER','inv.pos.%','campus'),
  -- Admission
  ('ADMISSION_OFFICER','adm.%','campus'), ('ADMISSION_OFFICER','sis.student.view','campus'),
  ('ADMISSION_OFFICER','sis.student.create','campus'), ('ADMISSION_OFFICER','sis.document.%','campus'),
  ('ADMISSION_OFFICER','sis.guardian.%','campus'), ('ADMISSION_OFFICER','sis.enrolment.edit','campus'), ('ADMISSION_OFFICER','sis.enrolment.view','campus'),
  ('ADMISSION_OFFICER','fee.invoice.view','campus'), ('ADMISSION_OFFICER','fee.invoice.create','campus'),
  ('ADMISSION_OFFICER','doc.document.create','campus'), ('ADMISSION_OFFICER','sec.visitor.%','campus'),
  -- HR
  ('HR','hrm.%','org'), ('HR','att.staff.%','org'), ('HR','att.staff_leave.%','org'), ('HR','doc.document.create','org'),
  -- Operations
  ('LIBRARIAN','lib.%','campus'), ('LIBRARIAN','sis.student.view','campus'), ('LIBRARIAN','hrm.staff.view','campus'),
  ('CLASS_TEACHER','lib.catalogue.view','campus'), ('CLASS_TEACHER','lib.digital.view','campus'),
  ('SUBJECT_TEACHER','lib.catalogue.view','campus'), ('SUBJECT_TEACHER','lib.digital.view','campus'),
  ('HEAD_OF_SECTION','lib.catalogue.view','campus'), ('HEAD_OF_SECTION','lib.digital.%','campus'),
  ('TRANSPORT','trn.%','campus'), ('TRANSPORT','sis.student.view','campus'), ('TRANSPORT','hrm.staff.view','campus'),
  ('DRIVER','trn.trip.%','campus'), ('DRIVER','trn.tracking.create','campus'), ('DRIVER','trn.vehicle.view','campus'),
  ('DRIVER','trn.route.view','campus'), ('DRIVER','trn.assignment.view','campus'),
  ('FRONT_DESK','trn.tracking.view','campus'), ('FRONT_DESK','trn.route.view','campus'),
  ('FRONT_DESK','hst.gate.%','campus'), ('FRONT_DESK','hst.outpass.view','campus'),
  ('WARDEN','hst.%','campus'), ('WARDEN','sis.student.view','campus'), ('WARDEN','sis.guardian.view','campus'),
  ('STORE_KEEPER','inv.%','campus'),
  ('NURSE','hlt.health.%','campus'), ('NURSE','sis.student.view','campus'),
  ('COUNSELLOR','hlt.counselling.%','campus'), ('COUNSELLOR','hlt.safeguarding.%','campus'),
  ('COUNSELLOR','hlt.behaviour.view','campus'), ('COUNSELLOR','sis.sen.%','campus'), ('COUNSELLOR','sis.student.view','campus'),
  ('FRONT_DESK','sec.%','campus'), ('FRONT_DESK','core.search.view','campus'),
  -- IT admin: users, roles, settings, master data; no student marks/fees editing
  ('IT_ADMIN','iam.%','org'), ('IT_ADMIN','core.%','org'), ('IT_ADMIN','wf.definition.%','org'),
  ('IT_ADMIN','com.template.%','org'), ('IT_ADMIN','doc.template.%','org'), ('IT_ADMIN','audit.event.view','org'),
  ('IT_ADMIN','att.device.%','org'), ('IT_ADMIN','web.content.%','org'),
  -- Parents & students (own children / self only)
  ('PARENT','prt.%','own_children'), ('PARENT','att.student_leave.create','own_children'),
  ('PARENT','com.message.%','own_children'), ('PARENT','adm.application.view','own_children'),
  ('PARENT','adm.application.create','own_children'), ('PARENT','sis.profile_change.view','own_children'),
  ('STUDENT','prt.portal.view','self'), ('STUDENT','prt.form.%','self'), ('STUDENT','lrn.homework.view','self'),
  ('STUDENT','lrn.resource.view','self'), ('STUDENT','lrn.quiz.view','self'),
  ('STUDENT','lib.catalogue.view','self'), ('STUDENT','lib.digital.view','self')
)
INSERT INTO iam.role_permission (role_id, permission_code, data_scope)
SELECT DISTINCT ON (ro.id, p.code) ro.id, p.code, rule.scope
  FROM rule
  JOIN iam.role ro ON ro.org_id = :'org_id' AND ro.code = rule.role_code
  JOIN iam.permission p ON p.code LIKE rule.pattern
 -- confidential data is never granted by wildcards to management roles; it is granted explicitly above
 WHERE NOT (rule.pattern LIKE '\%%' AND p.module || '.' || p.resource IN
            ('hlt.counselling','hlt.safeguarding','sis.sen','iam.user','iam.role'))
 ORDER BY ro.id, p.code
ON CONFLICT (role_id, permission_code) DO NOTHING;

-- Grading schemes (Appendix A) -----------------------------------------------------------------------
INSERT INTO exm.grading_scheme (org_id, code, name_en, kind) VALUES
  (:'org_id','EDX_IGCSE_9_1','Pearson Edexcel International GCSE 9-1','band'),
  (:'org_id','EDX_IAL_A_E',  'Pearson Edexcel International A Level A*-E','band'),
  (:'org_id','GPA_5',        'Local GPA 5.00 scale','gpa'),
  (:'org_id','LETTER_A_E',   'Lower Secondary A-E','band'),
  (:'org_id','PRIMARY_DESC', 'Primary descriptors','descriptor')
ON CONFLICT (org_id, code, version) DO NOTHING;

INSERT INTO exm.grade_band (scheme_id, grade, label_bn, min_percent, max_percent, grade_point, is_pass, seq)
SELECT s.id, b.grade, b.label_bn, b.lo, b.hi, b.gp, b.pass, b.seq
  FROM exm.grading_scheme s
  JOIN (VALUES
    -- Illustrative defaults: the exam office edits these (spec Appendix A)
    ('EDX_IGCSE_9_1','9',NULL,90,100,NULL,true,1), ('EDX_IGCSE_9_1','8',NULL,80,89.99,NULL,true,2),
    ('EDX_IGCSE_9_1','7',NULL,70,79.99,NULL,true,3), ('EDX_IGCSE_9_1','6',NULL,60,69.99,NULL,true,4),
    ('EDX_IGCSE_9_1','5',NULL,50,59.99,NULL,true,5), ('EDX_IGCSE_9_1','4',NULL,40,49.99,NULL,true,6),
    ('EDX_IGCSE_9_1','3',NULL,30,39.99,NULL,false,7), ('EDX_IGCSE_9_1','2',NULL,20,29.99,NULL,false,8),
    ('EDX_IGCSE_9_1','1',NULL,10,19.99,NULL,false,9), ('EDX_IGCSE_9_1','U',NULL,0,9.99,NULL,false,10),
    ('EDX_IAL_A_E','A*',NULL,90,100,NULL,true,1), ('EDX_IAL_A_E','A',NULL,80,89.99,NULL,true,2),
    ('EDX_IAL_A_E','B',NULL,70,79.99,NULL,true,3), ('EDX_IAL_A_E','C',NULL,60,69.99,NULL,true,4),
    ('EDX_IAL_A_E','D',NULL,50,59.99,NULL,true,5), ('EDX_IAL_A_E','E',NULL,40,49.99,NULL,true,6),
    ('EDX_IAL_A_E','U',NULL,0,39.99,NULL,false,7),
    ('GPA_5','A+','এ+',80,100,5.00,true,1), ('GPA_5','A','এ',70,79.99,4.00,true,2),
    ('GPA_5','A-','এ-',60,69.99,3.50,true,3), ('GPA_5','B','বি',50,59.99,3.00,true,4),
    ('GPA_5','C','সি',40,49.99,2.00,true,5), ('GPA_5','D','ডি',33,39.99,1.00,true,6),
    ('GPA_5','F','এফ',0,32.99,0.00,false,7),
    ('LETTER_A_E','A',NULL,80,100,NULL,true,1), ('LETTER_A_E','B',NULL,65,79.99,NULL,true,2),
    ('LETTER_A_E','C',NULL,50,64.99,NULL,true,3), ('LETTER_A_E','D',NULL,40,49.99,NULL,true,4),
    ('LETTER_A_E','E',NULL,0,39.99,NULL,false,5),
    ('PRIMARY_DESC','Exceeding','প্রত্যাশার চেয়ে বেশি',80,100,NULL,true,1),
    ('PRIMARY_DESC','Meeting','প্রত্যাশা অনুযায়ী',55,79.99,NULL,true,2),
    ('PRIMARY_DESC','Working Towards','অগ্রগতির পথে',0,54.99,NULL,true,3)
  ) AS b(code, grade, label_bn, lo, hi, gp, pass, seq) ON b.code = s.code
 WHERE s.org_id = :'org_id'
ON CONFLICT (scheme_id, grade) DO NOTHING;

-- Programmes & year groups (Early Years -> IAL) ----------------------------------------------------------
INSERT INTO aca.programme (org_id, code, name_en, name_bn, awarding_body, default_grading_scheme_id, seq)
SELECT :'org_id', p.code, p.name_en, p.name_bn, p.body, (SELECT id FROM exm.grading_scheme WHERE org_id = :'org_id' AND code = p.scheme), p.seq
  FROM (VALUES
    ('EY','Early Years','প্রারম্ভিক শিক্ষা',NULL,'PRIMARY_DESC',1),
    ('PRI','Primary (Years 1-6)','প্রাথমিক',NULL,'PRIMARY_DESC',2),
    ('LS','Lower Secondary (Years 7-9)','নিম্ন মাধ্যমিক',NULL,'LETTER_A_E',3),
    ('IGCSE','International GCSE (Years 10-11)','ইন্টারন্যাশনাল জিসিএসই','PEARSON_EDEXCEL','EDX_IGCSE_9_1',4),
    ('IAL','International A Level (AS / A2)','ইন্টারন্যাশনাল এ লেভেল','PEARSON_EDEXCEL','EDX_IAL_A_E',5)
  ) p(code, name_en, name_bn, body, scheme, seq)
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO aca.year_group (programme_id, code, name_en, seq, min_age_months)
SELECT pr.id, y.code, y.name_en, y.seq, y.min_age
  FROM (VALUES
    ('EY','PG','Playgroup',1,36), ('EY','NUR','Nursery',2,48), ('EY','KG','Kindergarten',3,60),
    ('PRI','Y1','Year 1',4,72), ('PRI','Y2','Year 2',5,84), ('PRI','Y3','Year 3',6,96),
    ('PRI','Y4','Year 4',7,108), ('PRI','Y5','Year 5',8,120), ('PRI','Y6','Year 6',9,132),
    ('LS','Y7','Year 7',10,144), ('LS','Y8','Year 8',11,156), ('LS','Y9','Year 9',12,168),
    ('IGCSE','Y10','Year 10',13,180), ('IGCSE','Y11','Year 11',14,192),
    ('IAL','AS','AS Level (Year 12)',15,204), ('IAL','A2','A2 Level (Year 13)',16,216)
  ) y(prog, code, name_en, seq, min_age)
  JOIN aca.programme pr ON pr.org_id = :'org_id' AND pr.code = y.prog
ON CONFLICT (programme_id, code) DO NOTHING;

UPDATE aca.year_group y SET next_year_group_id = n.id
  FROM aca.year_group n, aca.programme p, aca.programme np
 WHERE p.id = y.programme_id AND np.id = n.programme_id AND p.org_id = :'org_id' AND np.org_id = :'org_id'
   AND n.seq = y.seq + 1 AND y.next_year_group_id IS NULL;

-- Exam types -------------------------------------------------------------------------------------------
INSERT INTO exm.exam_type (org_id, code, name_en, name_bn) VALUES
  (:'org_id','CT','Class Test','ক্লাস টেস্ট'), (:'org_id','MID','Mid-term Examination','অর্ধবার্ষিক পরীক্ষা'),
  (:'org_id','FINAL','Final Examination','বার্ষিক পরীক্ষা'), (:'org_id','MOCK','Mock Examination','মক পরীক্ষা'),
  (:'org_id','BOARD','Board Practice','বোর্ড অনুশীলন')
ON CONFLICT (org_id, code) DO NOTHING;

-- Fee heads & concession types --------------------------------------------------------------------------
INSERT INTO fee.fee_head (org_id, code, name_en, name_bn, kind, frequency, is_refundable, priority) VALUES
  (:'org_id','LATE_FINE','Late payment fine','বিলম্ব জরিমানা','fine','on_demand',false,10),
  (:'org_id','LIB_FINE','Library fine','লাইব্রেরি জরিমানা','fine','on_demand',false,11),
  (:'org_id','OPENING_BAL','Opening balance (migrated arrears)','পূর্ববর্তী বকেয়া','opening_balance','one_time',false,20),
  (:'org_id','ADMISSION','Admission fee','ভর্তি ফি','admission','one_time',false,30),
  (:'org_id','SESSION','Session fee','সেশন ফি','session','annual',false,40),
  (:'org_id','EXAM','Examination fee','পরীক্ষা ফি','exam','termly',false,50),
  (:'org_id','EDEXCEL_ENTRY','Edexcel entry fee','এডেক্সেল এন্ট্রি ফি','external_exam','on_demand',true,55),
  (:'org_id','LAB','Laboratory fee','ল্যাব ফি','lab','annual',false,60),
  (:'org_id','ACTIVITY','Activity / club fee','কার্যক্রম ফি','activity','monthly',false,70),
  (:'org_id','TRANSPORT','Transport fee','পরিবহন ফি','transport','monthly',false,80),
  (:'org_id','HOSTEL','Hostel rent','হোস্টেল ভাড়া','service','monthly',false,85),
  (:'org_id','MEAL','Hostel meals','হোস্টেল খাবার','service','monthly',false,86),
  (:'org_id','UNIFORM','Uniform & books','ইউনিফর্ম ও বই','uniform','on_demand',false,85),
  (:'org_id','ID_CARD','ID card reissue','আইডি কার্ড পুনঃইস্যু','service','on_demand',false,90),
  (:'org_id','TUITION','Tuition fee','টিউশন ফি','tuition','monthly',false,100)
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO fee.concession_type (org_id, code, name_en, calc, default_value, applies_to_head_ids, stacking, max_percent_cap, requires_approval, auto_rule)
SELECT :'org_id', c.code, c.name_en, c.calc, c.val,
       ARRAY(SELECT id FROM fee.fee_head WHERE org_id = :'org_id' AND code = 'TUITION'),
       c.stacking, c.cap, c.approval, c.rule::jsonb
  FROM (VALUES
    ('SIBLING','Sibling discount','percent',10,'best_of',50,false,'{"sibling_rank_gte": 2}'),
    ('STAFF_WARD','Staff ward discount','percent',50,'best_of',100,true,'{"guardian_is_staff": true}'),
    ('MERIT','Merit scholarship','percent',25,'best_of',100,true,NULL),
    ('NEED','Need-based support','percent',0,'best_of',100,true,NULL),
    ('SPECIAL','Special waiver (one-off amount)','amount',0,'additive',NULL,true,NULL)
  ) c(code, name_en, calc, val, stacking, cap, approval, rule)
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO fee.late_fee_rule (org_id, applies_to_head_ids, fine_head_id, grace_days, calc, value, cap_paisa)
SELECT :'org_id', ARRAY(SELECT id FROM fee.fee_head WHERE org_id = :'org_id' AND code = 'TUITION'),
       (SELECT id FROM fee.fee_head WHERE org_id = :'org_id' AND code = 'LATE_FINE'), 5, 'flat', 20000, 20000
 WHERE NOT EXISTS (SELECT 1 FROM fee.late_fee_rule WHERE org_id = :'org_id');

-- HTML e-mail templates for the main events (values are HTML-escaped; the school layout is added by the hub).
-- Events without an e-mail / push template use their SMS text automatically.
INSERT INTO com.message_template (org_id, event_code, channel, locale, subject, body, is_active) VALUES
  (:'org_id','fee.invoice_issued','email','en','Invoice {{invoice_no}} for {{student_name}}',
   '<p>Dear Guardian,</p><p>Invoice <strong>{{invoice_no}}</strong> of <strong>Tk {{amount}}</strong> for {{student_name}} has been issued and is due on <strong>{{due_date}}</strong>.</p><p><a href="{{pay_link}}" style="display:inline-block;background:#1f4e79;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none">Pay online</a></p><p>You can also pay at the school cash counter.</p>', true),
  (:'org_id','fee.payment_received','email','en','Payment received - receipt {{receipt_no}}',
   '<p>Dear Guardian,</p><p>We have received <strong>Tk {{amount}}</strong>. Your receipt number is <strong>{{receipt_no}}</strong>.</p><p>Thank you.</p>', true),
  (:'org_id','hrm.payslip_ready','email','en','Your payslip for {{month}}',
   '<p>Dear colleague,</p><p>Your salary for <strong>{{month}}</strong> has been processed. Your payslip is available in the staff app and can be downloaded as PDF.</p>', true),
  (:'org_id','com.notice_urgent','email','en','URGENT: {{title}}',
   '<p style="color:#b42318;font-weight:600">Urgent notice</p><p style="white-space:pre-line">{{body}}</p>', true),
  (:'org_id','com.notice_published','email','en','{{title}}',
   '<p style="white-space:pre-line">{{body}}</p>{{#if circular_no}}<p style="color:#5b6b7f">Circular {{circular_no}}</p>{{/if}}', true),
  (:'org_id','fee.invoice_issued','email','bn','{{student_name}}-এর ইনভয়েস {{invoice_no}}',
   '<p>প্রিয় অভিভাবক,</p><p>{{student_name}}-এর জন্য <strong>{{amount}} টাকার</strong> ইনভয়েস <strong>{{invoice_no}}</strong> ইস্যু করা হয়েছে। পরিশোধের শেষ তারিখ <strong>{{due_date}}</strong>।</p><p><a href="{{pay_link}}" style="display:inline-block;background:#1f4e79;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none">অনলাইনে পরিশোধ করুন</a></p><p>বিদ্যালয়ের ক্যাশ কাউন্টারেও পরিশোধ করা যাবে।</p>', true),
  (:'org_id','fee.payment_received','email','bn','পরিশোধ গৃহীত - রসিদ {{receipt_no}}',
   '<p>প্রিয় অভিভাবক,</p><p>আমরা <strong>{{amount}} টাকা</strong> পেয়েছি। আপনার রসিদ নম্বর <strong>{{receipt_no}}</strong>।</p><p>ধন্যবাদ।</p>', true),
  (:'org_id','hrm.payslip_ready','email','bn','{{month}} মাসের পে-স্লিপ',
   '<p>প্রিয় সহকর্মী,</p><p><strong>{{month}}</strong> মাসের বেতন প্রক্রিয়া করা হয়েছে। স্টাফ অ্যাপে আপনার পে-স্লিপ দেখা ও PDF হিসেবে ডাউনলোড করা যাবে।</p>', true),
  (:'org_id','com.notice_urgent','email','bn','জরুরি: {{title_bn}}',
   '<p style="color:#b42318;font-weight:600">জরুরি নোটিশ</p><p style="white-space:pre-line">{{body_bn}}</p>', true),
  (:'org_id','com.notice_published','email','bn','{{title_bn}}',
   '<p style="white-space:pre-line">{{body_bn}}</p>{{#if circular_no}}<p style="color:#5b6b7f">সার্কুলার {{circular_no}}</p>{{/if}}', true),
  (:'org_id','hrm.cpd_session_cancelled','email','en','Training cancelled: {{title}}',
   '<p>Dear colleague,</p><p>The training <strong>{{title}}</strong> scheduled for <strong>{{when}}</strong> has been cancelled.</p><p>Reason: {{reason}}</p><p>Your registration has been withdrawn; you will be told when it is rescheduled.</p>', true),
  (:'org_id','hrm.cpd_session_cancelled','email','bn','প্রশিক্ষণ বাতিল: {{title}}',
   '<p>প্রিয় সহকর্মী,</p><p><strong>{{when}}</strong> তারিখের প্রশিক্ষণ <strong>{{title}}</strong> বাতিল করা হয়েছে।</p><p>কারণ: {{reason}}</p><p>আপনার নিবন্ধন প্রত্যাহার করা হয়েছে; নতুন সময় নির্ধারিত হলে জানানো হবে।</p>', true),
  (:'org_id','acc.requisition_decided','email','en','Requisition {{pr_no}} {{decision}}',
   '<p>Your purchase requisition <strong>{{pr_no}}</strong> ({{title}}) was <strong>{{decision}}</strong>.</p>{{#if note}}<p>Note: {{note}}</p>{{/if}}', true),
  (:'org_id','acc.requisition_decided','email','bn','ক্রয় অনুরোধ {{pr_no}} {{decision}}',
   '<p>আপনার ক্রয় অনুরোধ <strong>{{pr_no}}</strong> ({{title}}) <strong>{{decision}}</strong> হয়েছে।</p>{{#if note}}<p>মন্তব্য: {{note}}</p>{{/if}}', true),
  (:'org_id','att.correction_decided','email','en','Attendance correction {{decision}}',
   '<p>Your correction of <strong>{{student_name}}</strong>''s {{register}} attendance on <strong>{{date}}</strong> (to {{new_status}}) was <strong>{{decision}}</strong>.</p>{{#if note}}<p>Note: {{note}}</p>{{/if}}', true),
  (:'org_id','att.correction_decided','email','bn','হাজিরা সংশোধন {{decision}}',
   '<p><strong>{{student_name}}</strong>-এর <strong>{{date}}</strong> তারিখের {{register}} হাজিরা সংশোধনের ({{new_status}}) অনুরোধ <strong>{{decision}}</strong> হয়েছে।</p>{{#if note}}<p>মন্তব্য: {{note}}</p>{{/if}}', true),
  (:'org_id','acc.budget_decided','email','en','Budget {{decision}}: {{budget_name}}',
   '<p>The budget <strong>{{budget_name}}</strong> you submitted was <strong>{{decision}}</strong>.</p>{{#if note}}<p>Note: {{note}}</p>{{/if}}', true),
  (:'org_id','acc.budget_decided','email','bn','বাজেট {{decision}}: {{budget_name}}',
   '<p>আপনার জমা দেওয়া বাজেট <strong>{{budget_name}}</strong> <strong>{{decision}}</strong> হয়েছে।</p>{{#if note}}<p>মন্তব্য: {{note}}</p>{{/if}}', true)
ON CONFLICT (org_id, event_code, channel, locale, version) DO NOTHING;

-- Organisation-wide number sequences (no campus): circulars ----------------------------------------------
INSERT INTO core.number_sequence (org_id, campus_id, seq_key, period_key, format)
VALUES (:'org_id', NULL, 'circular', '', 'CIR-{YY}-{SEQ:4}'),
       (:'org_id', NULL, 'cpd_certificate', '', 'CPD-{YY}-{SEQ:5}')
ON CONFLICT DO NOTHING;

-- Salary components (HRM-04) ------------------------------------------------------------------------------
-- BASIC comes from the contract; LWP / LOAN / ADVANCE are computed by payroll; FEST_BONUS is occasional
-- (paid only in runs that include it, setting hrm.occasional_components).
INSERT INTO hrm.salary_component (org_id, code, name_en, kind, calc, taxable, seq) VALUES
  (:'org_id','BASIC',           'Basic salary',               'earning',               'fixed',            true,  10),
  (:'org_id','HOUSE',           'House rent allowance',       'earning',               'percent_of_basic', true,  20),
  (:'org_id','MEDICAL',         'Medical allowance',          'earning',               'fixed',            true,  30),
  (:'org_id','CONVEYANCE',      'Conveyance allowance',       'earning',               'fixed',            true,  40),
  (:'org_id','COVER_PAY',       'Cover class pay',            'earning',               'per_unit',         true,  50),
  (:'org_id','OT',              'Overtime (per hour)',        'earning',               'per_unit',         true,  60),
  (:'org_id','FEST_BONUS',      'Festival bonus',             'earning',               'percent_of_basic', true,  70),
  (:'org_id','OTHER_EARNING',   'Other earning',              'earning',               'fixed',            true,  80),
  (:'org_id','PF',              'Provident fund (employee)',  'deduction',             'percent_of_basic', false, 110),
  (:'org_id','TAX',             'Income tax (TDS)',           'deduction',             'fixed',            false, 120),
  (:'org_id','LWP',             'Leave without pay',          'deduction',             'per_unit',         false, 130),
  (:'org_id','LOAN',            'Loan installment',           'deduction',             'fixed',            false, 140),
  (:'org_id','ADVANCE',         'Salary advance recovery',    'deduction',             'fixed',            false, 150),
  (:'org_id','OTHER_DEDUCTION', 'Other deduction',            'deduction',             'fixed',            false, 160),
  (:'org_id','PF_EMPLOYER',     'Provident fund (employer)',  'employer_contribution', 'percent_of_basic', false, 210)
ON CONFLICT (org_id, code) DO NOTHING;

-- Chart of accounts (ACC-01): school defaults; payroll postings use acc.payroll_accounts (codes) ---------------
INSERT INTO acc.account (org_id, code, name_en, kind, is_postable) VALUES
  (:'org_id','1000','Assets','asset',false),
  (:'org_id','2000','Liabilities','liability',false),
  (:'org_id','3000','Equity','equity',false),
  (:'org_id','4000','Income','income',false),
  (:'org_id','5000','Expenses','expense',false)
ON CONFLICT (org_id, code) DO NOTHING;
INSERT INTO acc.account (org_id, code, name_en, kind, parent_id, is_cash, is_bank)
SELECT :'org_id', a.code, a.name, a.kind, (SELECT id FROM acc.account p WHERE p.org_id = :'org_id' AND p.code = a.parent),
       a.is_cash, a.is_bank
  FROM (VALUES
    ('1100','Cash in hand','asset','1000',true,false),
    ('1110','Bank - operating account','asset','1000',false,true),
    ('1120','Payment gateway clearing','asset','1000',false,false),
    ('1200','Fees receivable','asset','1000',false,false),
    ('1210','Staff loans and advances','asset','1000',false,false),
    ('2100','Salaries payable','liability','2000',false,false),
    ('2110','Provident fund payable','liability','2000',false,false),
    ('2120','Tax deducted at source payable','liability','2000',false,false),
    ('2190','Other payroll deductions payable','liability','2000',false,false),
    ('2200','Fees received in advance','liability','2000',false,false),
    ('3100','Accumulated fund','equity','3000',false,false),
    ('4100','Tuition fees','income','4000',false,false),
    ('4110','Admission and session fees','income','4000',false,false),
    ('4120','Transport fees','income','4000',false,false),
    ('4190','Other fees and fines','income','4000',false,false),
    ('5100','Salaries and allowances','expense','5000',false,false),
    ('5110','Employer provident fund contribution','expense','5000',false,false),
    ('5120','Festival bonus','expense','5000',false,false),
    ('5130','Overtime and cover pay','expense','5000',false,false),
    ('2130','VAT deducted at source payable','liability','2000',false,false),
    ('2300','Accounts payable - suppliers','liability','2000',false,false),
    ('5200','Teaching materials and supplies','expense','5000',false,false),
    ('5210','Repairs and maintenance','expense','5000',false,false),
    ('5220','Utilities','expense','5000',false,false),
    ('5230','IT, software and subscriptions','expense','5000',false,false),
    ('5240','Furniture and small equipment','expense','5000',false,false),
    ('5250','Library books and resources','expense','5000',false,false),
    ('5260','Transport running costs','expense','5000',false,false),
    ('5290','Other administrative expenses','expense','5000',false,false)
  ) a(code, name, kind, parent, is_cash, is_bank)
ON CONFLICT (org_id, code) DO NOTHING;

-- Houses (CCA-02): four houses; rename or add more in the app
INSERT INTO cca.house (org_id, code, name_en, name_bn, colour_hex) VALUES
  (:'org_id','RED','Red House','লাল হাউস','#C62828'), (:'org_id','BLUE','Blue House','নীল হাউস','#1565C0'),
  (:'org_id','GREEN','Green House','সবুজ হাউস','#2E7D32'), (:'org_id','YELLOW','Yellow House','হলুদ হাউস','#F9A825')
ON CONFLICT (org_id, code) DO NOTHING;

-- Cost centres (budget departments, ACC-03)
INSERT INTO acc.cost_centre (org_id, code, name_en) VALUES
  (:'org_id','ACAD','Academics'), (:'org_id','ADMIN','Administration'), (:'org_id','IT','IT'),
  (:'org_id','LIB','Library'), (:'org_id','ESTATE','Estates and maintenance'), (:'org_id','TRANS','Transport'),
  (:'org_id','CCA','Co-curricular activities')
ON CONFLICT (org_id, code) DO NOTHING;

-- Income-tax tables for salary TDS (HRM-04). Amounts in paisa. NOT VERIFIED against the gazette: compiled from the
-- Finance Ordinance 2025 / Finance Act 2026 summaries (KPMG-RRH, PwC Worldwide Tax Summaries reviewed 31 Jul 2026,
-- Daily Star / TBS 29-30 Jun 2026). Check against the NBR / gazette text, then POST /hrm/tax-years/{code}/verify;
-- until then every payroll compute shows TAX_TABLE_UNVERIFIED. Re-seeding updates unverified years only.
--   Income year 2025-26 = assessment year 2026-27; the Finance Act 2026 set it to Tk 4 lakh (the Ordinance had
--   Tk 3.75 lakh). Open points: investment rebate of 2025-26 (15% / Tk 10 lakh kept; PwC shows 10% / Tk 7.5 lakh
--   without a start year) and whether July Warriors share the Tk 5.5 lakh row.
INSERT INTO hrm.tax_year (org_id, code, starts_on, ends_on, rules, source_note) VALUES
  (:'org_id','2025-26','2025-07-01','2026-06-30', '{
     "thresholds": {"general": 40000000, "female": 45000000, "senior": 45000000, "disabled": 52500000, "third_gender": 52500000, "freedom_fighter": 55000000},
     "slabs": [{"widthPaisa": 30000000, "ratePct": 10}, {"widthPaisa": 40000000, "ratePct": 15}, {"widthPaisa": 50000000, "ratePct": 20},
               {"widthPaisa": 200000000, "ratePct": 25}, {"widthPaisa": null, "ratePct": 30}],
     "salaryExemption": {"fraction": 0.3333333333, "capPaisa": 50000000},
     "rebate": {"incomePct": 3, "investmentPct": 15, "capPaisa": 100000000},
     "minimumTaxPaisa": 500000, "newTaxpayerMinimumTaxPaisa": 100000, "disabledChildAllowancePaisa": 5000000}',
   'Unverified: income year 2025-26 (AY 2026-27) as re-enacted by the Finance Act 2026 (Tk 4 lakh). Rebate kept at the Ordinance 2025 values (3% / 15% / Tk 10 lakh) - confirm.'),
  (:'org_id','2026-27','2026-07-01','2027-06-30', '{
     "thresholds": {"general": 40000000, "female": 45000000, "senior": 45000000, "disabled": 52500000, "third_gender": 52500000, "freedom_fighter": 55000000},
     "slabs": [{"widthPaisa": 30000000, "ratePct": 10}, {"widthPaisa": 40000000, "ratePct": 15}, {"widthPaisa": 50000000, "ratePct": 20},
               {"widthPaisa": 200000000, "ratePct": 25}, {"widthPaisa": null, "ratePct": 30}],
     "salaryExemption": {"fraction": 0.3333333333, "capPaisa": 50000000},
     "rebate": {"incomePct": 3, "investmentPct": 10, "capPaisa": 75000000},
     "minimumTaxPaisa": 500000, "newTaxpayerMinimumTaxPaisa": 100000, "disabledChildAllowancePaisa": 5000000}',
   'Unverified: income year 2026-27 (AY 2027-28) per the Finance Act 2026 as passed 29 Jun 2026 (thresholds raised by Tk 25,000 from the Bill).')
ON CONFLICT (org_id, code) DO UPDATE SET rules = EXCLUDED.rules, source_note = EXCLUDED.source_note
  WHERE hrm.tax_year.verified_at IS NULL;

-- Library member policies (LIB-02) -------------------------------------------------------------------------
INSERT INTO lib.member_policy (org_id, member_type, max_loans, loan_days, max_renewals, fine_per_day_paisa) VALUES
  (:'org_id','student_junior', 2,  7, 1,  500),
  (:'org_id','student_senior', 3, 14, 1,  500),
  (:'org_id','teacher',       10, 30, 2,    0),
  (:'org_id','staff',          5, 14, 1,    0)
ON CONFLICT (org_id, member_type) DO NOTHING;

-- Staff leave types --------------------------------------------------------------------------------------
INSERT INTO att.staff_leave_type (org_id, code, name_en, name_bn, annual_quota_days, max_carry_forward, is_paid, gender_restriction, requires_document_after_days) VALUES
  (:'org_id','CL','Casual leave','নৈমিত্তিক ছুটি',10,0,true,NULL,NULL),
  (:'org_id','SL','Sick leave','অসুস্থতাজনিত ছুটি',14,0,true,NULL,2),
  (:'org_id','EL','Earned leave','অর্জিত ছুটি',18,30,true,NULL,NULL),
  (:'org_id','ML','Maternity leave','মাতৃত্বকালীন ছুটি',112,0,true,'female',NULL),
  (:'org_id','LWP','Leave without pay','বিনা বেতনে ছুটি',365,0,false,NULL,NULL)
ON CONFLICT (org_id, code) DO NOTHING;

INSERT INTO att.attendance_rule (org_id, min_percent, warning_levels, late_counts_as, period)
SELECT :'org_id', 80.00, '{90,85}', 0.33, 'term'
 WHERE NOT EXISTS (SELECT 1 FROM att.attendance_rule WHERE org_id = :'org_id');

-- Configurable lookup lists ----------------------------------------------------------------------------
INSERT INTO core.lookup_value (org_id, list_code, code, label_en, label_bn, seq)
SELECT :'org_id', l.list, l.code, l.en, l.bn, l.seq FROM (VALUES
  ('lead_source','website','Website','ওয়েবসাইট',1), ('lead_source','phone','Phone call','ফোন',2),
  ('lead_source','walk_in','Walk-in','সরাসরি',3), ('lead_source','facebook','Facebook','ফেসবুক',4),
  ('lead_source','qr_campaign','QR campaign','কিউআর ক্যাম্পেইন',5), ('lead_source','referral','Referral','রেফারেল',6),
  ('lost_reason','fees','Fees too high','ফি বেশি',1), ('lost_reason','distance','Distance','দূরত্ব',2),
  ('lost_reason','other_school','Chose another school','অন্য স্কুল',3), ('lost_reason','no_seat','No seat','আসন নেই',4),
  ('student_doc_type','birth_cert','Birth certificate','জন্ম নিবন্ধন',1), ('student_doc_type','prev_report','Previous report card','পূর্ববর্তী রিপোর্ট কার্ড',2),
  ('student_doc_type','photo','Passport photo','ছবি',3), ('student_doc_type','vaccination','Vaccination card','টিকা কার্ড',4),
  ('student_doc_type','tc','Transfer certificate','ছাড়পত্র',5), ('student_doc_type','passport','Passport','পাসপোর্ট',6),
  ('occupation','business','Business','ব্যবসা',1), ('occupation','service','Service','চাকরি',2),
  ('occupation','doctor','Doctor','চিকিৎসক',3), ('occupation','engineer','Engineer','প্রকৌশলী',4),
  ('occupation','teacher','Teacher','শিক্ষক',5), ('occupation','homemaker','Homemaker','গৃহিণী',6), ('occupation','other','Other','অন্যান্য',9),
  ('leave_reason','illness','Illness','অসুস্থতা',1), ('leave_reason','family','Family event','পারিবারিক',2),
  ('leave_reason','travel','Travel','ভ্রমণ',3), ('leave_reason','religious','Religious observance','ধর্মীয়',4), ('leave_reason','other','Other','অন্যান্য',9),
  ('withdrawal_reason','relocation','Relocation','স্থানান্তর',1), ('withdrawal_reason','abroad','Moving abroad','বিদেশ গমন',2),
  ('withdrawal_reason','other_school','Other school','অন্য স্কুল',3), ('withdrawal_reason','financial','Financial','আর্থিক',4),
  ('behaviour_category','homework','Homework','বাড়ির কাজ',1), ('behaviour_category','punctuality','Punctuality','সময়ানুবর্তিতা',2),
  ('behaviour_category','respect','Respect','সম্মান',3), ('behaviour_category','uniform','Uniform','ইউনিফর্ম',4),
  ('behaviour_category','helping','Helping others','সহায়তা',5), ('behaviour_category','leadership','Leadership','নেতৃত্ব',6),
  ('complaint_category','academic','Academic','একাডেমিক',1), ('complaint_category','fees','Fees','ফি',2),
  ('complaint_category','transport','Transport','পরিবহন',3), ('complaint_category','facilities','Facilities','সুবিধা',4),
  ('complaint_category','staff','Staff conduct','কর্মীর আচরণ',5)
) l(list, code, en, bn, seq)
ON CONFLICT (org_id, list_code, code) DO NOTHING;

-- Settings defaults -------------------------------------------------------------------------------------
INSERT INTO core.setting (org_id, campus_id, key, value) VALUES
  (:'org_id', NULL, 'attendance.late_cutoff_time', '"08:15"'),
  (:'org_id', NULL, 'attendance.edit_window_hours', '12'),
  (:'org_id', NULL, 'attendance.alert_channels', '["sms","push"]'),
  (:'org_id', NULL, 'attendance.period_wise_year_groups', '["Y10","Y11","AS","A2"]'),
  (:'org_id', NULL, 'fee.reminder_offsets_days', '[-3, 0, 7, 15]'),
  (:'org_id', NULL, 'fee.default_due_day', '10'),
  (:'org_id', NULL, 'exam.show_position', 'false'),
  (:'org_id', NULL, 'locale.default', '"bn"'),
  (:'org_id', NULL, 'calendar.hijri_display', 'true'),
  (:'org_id', NULL, 'week.working_days', '[6,0,1,2,3,4]'),
  (:'org_id', NULL, 'notify.quiet_hours', '{"from":"21:30","to":"07:00"}'),
  (:'org_id', NULL, 'org.display_name', '"Lighthouse International School"'),
  (:'org_id', NULL, 'hrm.cpd_target_hours', '20'),
  (:'org_id', NULL, 'acc.procurement_accounts', '{"payable":"2300","vat":"2130","tds":"2120","bank":"1110","cash":"1100","mobile":"1120"}'),
  (:'org_id', NULL, 'acc.quotation_threshold_paisa', '2500000'),
  (:'org_id', NULL, 'acc.min_quotations', '3'),
  (:'org_id', NULL, 'hostel.meal_times', '{"breakfast":"07:30","lunch":"13:30","snacks":"17:00","dinner":"20:30"}'),
  (:'org_id', NULL, 'hostel.meal_optout_cutoff_hours', '4'),
  (:'org_id', NULL, 'adm.spam_threshold', '50'),
  (:'org_id', NULL, 'adm.duplicate_window_days', '30'),
  (:'org_id', NULL, 'adm.form_min_seconds', '4')
ON CONFLICT (org_id, campus_id, key) DO NOTHING;

-- Number sequences per campus -----------------------------------------------------------------------------
INSERT INTO core.number_sequence (org_id, campus_id, seq_key, period_key, format)
SELECT :'org_id', c.id, s.key, '', s.fmt
  FROM core.campus c
  CROSS JOIN (VALUES
    ('admission_no','{CAMPUS}-{YYYY}-{SEQ:4}'), ('application','APP-{CAMPUS}-{YY}-{SEQ:5}'), ('enquiry','ENQ-{CAMPUS}-{YY}-{SEQ:5}'),
    ('invoice','INV-{CAMPUS}-{YYMM}-{SEQ:6}'), ('payment','PAY-{CAMPUS}-{YY}-{SEQ:6}'),
    ('receipt','RCP-{CAMPUS}-{YY}-{SEQ:6}'), ('offer','OFR-{CAMPUS}-{YY}-{SEQ:4}'),
    ('tc','TC-{CAMPUS}-{YY}-{SEQ:4}'), ('certificate','CRT-{CAMPUS}-{YY}-{SEQ:5}'),
    ('complaint','CMP-{CAMPUS}-{YY}-{SEQ:5}'), ('pos_sale','POS-{CAMPUS}-{YY}-{SEQ:6}'),
    ('ticket','MNT-{CAMPUS}-{YY}-{SEQ:5}'), ('journal','JV-{CAMPUS}-{YY}-{SEQ:6}'),
    ('lib_accession','{CAMPUS}-L{SEQ:6}'), ('requisition','PR-{CAMPUS}-{YY}-{SEQ:5}'),
    ('purchase_order','PO-{CAMPUS}-{YY}-{SEQ:5}'), ('grn','GRN-{CAMPUS}-{YY}-{SEQ:5}'),
    ('supplier_payment','SPY-{CAMPUS}-{YY}-{SEQ:5}')
  ) s(key, fmt)
 WHERE c.org_id = :'org_id'
ON CONFLICT (org_id, campus_id, seq_key, period_key) DO NOTHING;

-- Organisation-wide sequences
INSERT INTO core.number_sequence (org_id, campus_id, seq_key, period_key, format)
VALUES (:'org_id', NULL, 'family', '', 'FAM-{SEQ:6}')
ON CONFLICT (org_id, campus_id, seq_key, period_key) DO NOTHING;

-- Approval workflows (CORE-03) -----------------------------------------------------------------------------
INSERT INTO wf.workflow_definition (org_id, code, name_en) VALUES
  (:'org_id','student_leave','Student leave'), (:'org_id','staff_leave','Staff leave'),
  (:'org_id','fee_concession','Fee concession / scholarship'), (:'org_id','fee_waiver','Fee waiver'),
  (:'org_id','refund','Refund'), (:'org_id','certificate_issue','Certificate issue'),
  (:'org_id','marks_reopen','Re-open locked marks'), (:'org_id','payroll','Monthly payroll'),
  (:'org_id','purchase','Purchase requisition'), (:'org_id','payment_reversal','Payment reversal')
ON CONFLICT (org_id, code, version) DO NOTHING;

INSERT INTO wf.workflow_step (definition_id, step_no, name_en, approver_type, approver_role_id, condition, escalate_after)
SELECT d.id, s.step, s.name, s.type, (SELECT id FROM iam.role WHERE org_id = :'org_id' AND code = s.role), s.cond::jsonb, s.esc::interval
  FROM wf.workflow_definition d
  JOIN (VALUES
    ('student_leave',1,'Class teacher','class_teacher',NULL,NULL,'24 hours'),
    ('staff_leave',1,'Reporting manager','reporting_manager',NULL,NULL,'24 hours'),
    ('staff_leave',2,'HR (more than 3 days)','role','HR','{"days":{"gt":3}}','48 hours'),
    ('fee_concession',1,'Accountant review','role','ACCOUNTANT',NULL,'48 hours'),
    ('fee_concession',2,'Principal approval','role','PRINCIPAL',NULL,'72 hours'),
    ('fee_waiver',1,'Campus head','role','CAMPUS_HEAD',NULL,'48 hours'),
    ('fee_waiver',2,'Principal (over 10,000 BDT)','role','PRINCIPAL','{"amount_paisa":{"gt":1000000}}','72 hours'),
    ('refund',1,'Accountant','role','ACCOUNTANT',NULL,'48 hours'),
    ('refund',2,'Principal','role','PRINCIPAL',NULL,'72 hours'),
    ('certificate_issue',1,'Campus head','role','CAMPUS_HEAD',NULL,'24 hours'),
    ('marks_reopen',1,'Head of section','head_of_section',NULL,NULL,'24 hours'),
    ('marks_reopen',2,'Exam officer','role','EXAM_OFFICER',NULL,'24 hours'),
    ('payroll',1,'Accountant','role','ACCOUNTANT',NULL,'48 hours'),
    ('payroll',2,'Principal','role','PRINCIPAL',NULL,'72 hours'),
    ('purchase',1,'Campus head','role','CAMPUS_HEAD',NULL,'48 hours'),
    ('payment_reversal',1,'Accountant','role','ACCOUNTANT',NULL,'24 hours')
  ) s(code, step, name, type, role, cond, esc) ON s.code = d.code
 WHERE d.org_id = :'org_id'
ON CONFLICT (definition_id, step_no) DO NOTHING;

-- Notification rules (Appendix C) -------------------------------------------------------------------------
INSERT INTO com.notification_rule (org_id, event_code, recipient, channels, priority, respect_quiet_hours) VALUES
  (:'org_id','att.absent','primary_guardian','{sms,push}','high',false),
  (:'org_id','att.late','primary_guardian','{sms,push}','normal',false),
  (:'org_id','att.period_missed','primary_guardian','{sms,push}','high',false),
  (:'org_id','att.leave_decided','primary_guardian','{push,in_app}','normal',true),
  (:'org_id','lrn.homework_assigned','student','{push,in_app}','low',true),
  (:'org_id','lrn.homework_due','all_guardians','{push,in_app}','low',true),
  (:'org_id','com.notice_published','targeted_audience','{push,in_app}','normal',true),
  (:'org_id','com.notice_urgent','targeted_audience','{sms,push,email}','high',false),
  (:'org_id','fee.invoice_issued','fee_payer','{sms,push,email}','normal',true),
  (:'org_id','fee.invoice_due','fee_payer','{sms,push}','normal',true),
  (:'org_id','fee.invoice_overdue','fee_payer','{sms,push,email}','normal',true),
  (:'org_id','fee.payment_received','fee_payer','{sms,push,email}','normal',false),
  (:'org_id','exm.admit_card_ready','all_guardians','{push,sms}','normal',true),
  (:'org_id','exm.result_published','all_guardians','{push,sms}','normal',true),
  (:'org_id','adm.offer_issued','applicant_guardian','{sms,email}','normal',true),
  (:'org_id','adm.test_scheduled','applicant_guardian','{sms,email}','normal',true),
  (:'org_id','aca.cover_assigned','substitute_teacher','{push,sms}','high',false),
  (:'org_id','wf.approval_pending','approver','{push,email}','normal',true),
  (:'org_id','com.emergency','all_guardians','{sms,push}','emergency',false),
  (:'org_id','iam.otp','requester','{sms}','high',false),
  (:'org_id','lib.loan_overdue','borrower','{sms,push}','normal',true),
  (:'org_id','hrm.payslip_ready','staff','{push,sms}','normal',true),
  (:'org_id','att.staff_leave_decided','staff','{push,sms}','normal',true),
  (:'org_id','att.correction_decided','requester','{push,email,in_app}','normal',true),
  (:'org_id','acc.requisition_decided','requester','{push,email,in_app}','normal',true),
  (:'org_id','acc.budget_decided','requester','{push,email,in_app}','normal',true),
  (:'org_id','hrm.cpd_session_cancelled','staff','{push,sms,email}','high',true),
  (:'org_id','adm.enquiry_received','enquirer','{sms,email}','normal',false),
  (:'org_id','adm.application_submitted','enquirer','{sms,email}','normal',false),
  (:'org_id','hst.absent','primary_guardian','{sms,push}','high',false),
  (:'org_id','hst.outpass_decided','primary_guardian','{push,sms}','normal',true),
  (:'org_id','hst.left','primary_guardian','{sms,push}','normal',false),
  (:'org_id','hst.returned','primary_guardian','{sms,push}','normal',false),
  (:'org_id','hst.overdue','primary_guardian','{sms,push}','high',false),
  (:'org_id','trn.bus_near_pickup','primary_guardian','{push,sms}','high',false),
  (:'org_id','trn.bus_near_drop','primary_guardian','{push,sms}','high',false),
  (:'org_id','lib.reservation_ready','borrower','{push,sms}','normal',true)
ON CONFLICT (org_id, event_code, recipient) DO NOTHING;

-- Message templates (en + bn, SMS) --------------------------------------------------------------------------
INSERT INTO com.message_template (org_id, event_code, channel, locale, body, is_active) VALUES
  (:'org_id','att.absent','sms','en','Dear Guardian, {{student_name}} ({{class}}) is absent today, {{date}}. - {{school}}', true),
  (:'org_id','att.absent','sms','bn','প্রিয় অভিভাবক, {{student_name}} ({{class}}) আজ {{date}} বিদ্যালয়ে অনুপস্থিত। - {{school}}', true),
  (:'org_id','att.late','sms','en','Dear Guardian, {{student_name}} arrived late today at {{time}}. - {{school}}', true),
  (:'org_id','att.period_missed','sms','en','Dear Guardian, {{student_name}} ({{class}}) was at school but missed {{period}} ({{subject_group}}) today, {{date}}. - {{school}}', true),
  (:'org_id','att.period_missed','sms','bn','প্রিয় অভিভাবক, {{student_name}} ({{class}}) আজ {{date}} বিদ্যালয়ে উপস্থিত থাকলেও {{period}} ({{subject_group}}) ক্লাসে অনুপস্থিত ছিল। - {{school}}', true),
  (:'org_id','att.late','sms','bn','প্রিয় অভিভাবক, {{student_name}} আজ {{time}}-এ দেরিতে উপস্থিত হয়েছে। - {{school}}', true),
  (:'org_id','fee.invoice_issued','sms','en','Invoice {{invoice_no}} of Tk {{amount}} for {{student_name}} is due on {{due_date}}. Pay: {{pay_link}}', true),
  (:'org_id','fee.invoice_issued','sms','bn','{{student_name}}-এর {{amount}} টাকার ইনভয়েস {{invoice_no}}, পরিশোধের শেষ তারিখ {{due_date}}। পরিশোধ: {{pay_link}}', true),
  (:'org_id','fee.payment_received','sms','en','Received Tk {{amount}} (receipt {{receipt_no}}). Thank you. - {{school}}', true),
  (:'org_id','fee.payment_received','sms','bn','{{amount}} টাকা গ্রহণ করা হয়েছে (রসিদ {{receipt_no}})। ধন্যবাদ। - {{school}}', true),
  (:'org_id','exm.result_published','sms','en','{{exam_name}} results for {{student_name}} are published. View in the parent app.', true),
  (:'org_id','exm.result_published','sms','bn','{{student_name}}-এর {{exam_name}} ফলাফল প্রকাশিত হয়েছে। অভিভাবক অ্যাপে দেখুন।', true),
  (:'org_id','com.emergency','sms','en','URGENT: {{message}} - {{school}}', true),
  (:'org_id','com.emergency','sms','bn','জরুরি: {{message}} - {{school}}', true),
  (:'org_id','iam.otp','sms','en','Your login code is {{code}}. It expires in {{minutes}} minutes. Never share it.', true),
  (:'org_id','iam.otp','sms','bn','আপনার লগইন কোড {{code}}। {{minutes}} মিনিটের মধ্যে ব্যবহার করুন। কাউকে জানাবেন না।', true),
  (:'org_id','lib.loan_overdue','sms','en','Library: "{{title}}" borrowed by {{borrower_name}} was due on {{due_date}} ({{days}} days late). Please return it. - {{school}}', true),
  (:'org_id','lib.loan_overdue','sms','bn','লাইব্রেরি: {{borrower_name}}-এর নেওয়া "{{title}}" বইটি {{due_date}} তারিখে ফেরতের কথা ছিল ({{days}} দিন দেরি)। অনুগ্রহ করে ফেরত দিন। - {{school}}', true),
  (:'org_id','com.notice_published','push','en','{{title}}', true),
  (:'org_id','com.notice_published','push','bn','{{title_bn}}', true),
  (:'org_id','com.notice_urgent','push','en','URGENT: {{title}}', true),
  (:'org_id','com.notice_urgent','push','bn','জরুরি: {{title_bn}}', true),
  (:'org_id','com.notice_urgent','sms','en','{{title}}: {{summary}} - {{school}}', true),
  (:'org_id','com.notice_urgent','sms','bn','{{title_bn}}: {{summary}} - {{school}}', true),
  (:'org_id','hst.absent','sms','en','{{student_name}} was not present at the {{session}} roll call of {{hostel}} on {{date}}. Please contact the warden. - {{school}}', true),
  (:'org_id','hst.absent','sms','bn','{{student_name}} {{date}} তারিখে {{hostel}}-এর {{session}} হাজিরায় উপস্থিত ছিল না। অনুগ্রহ করে ওয়ার্ডেনের সাথে যোগাযোগ করুন। - {{school}}', true),
  (:'org_id','hst.outpass_decided','sms','en','Out-pass for {{student_name}} ({{from}} to {{to}}) was {{decision}}. - {{school}}', true),
  (:'org_id','hst.outpass_decided','sms','bn','{{student_name}}-এর আউট-পাস ({{from}} থেকে {{to}}) {{decision}} হয়েছে। - {{school}}', true),
  (:'org_id','hst.left','sms','en','{{student_name}} left {{hostel}} at {{time}}; expected back by {{return_by}}. - {{school}}', true),
  (:'org_id','hst.left','sms','bn','{{student_name}} {{time}}-এ {{hostel}} থেকে বের হয়েছে; ফেরার সময় {{return_by}}। - {{school}}', true),
  (:'org_id','hst.returned','sms','en','{{student_name}} returned to {{hostel}} at {{time}}. - {{school}}', true),
  (:'org_id','hst.returned','sms','bn','{{student_name}} {{time}}-এ {{hostel}}-এ ফিরেছে। - {{school}}', true),
  (:'org_id','hst.overdue','sms','en','URGENT: {{student_name}} has not returned to {{hostel}} (due {{return_by}}). Please contact the warden. - {{school}}', true),
  (:'org_id','hst.overdue','sms','bn','জরুরি: {{student_name}} এখনও {{hostel}}-এ ফেরেনি (ফেরার সময় ছিল {{return_by}})। অনুগ্রহ করে ওয়ার্ডেনের সাথে যোগাযোগ করুন। - {{school}}', true),
  (:'org_id','att.staff_leave_decided','sms','en','Your {{leave}} leave from {{from}} to {{to}} ({{days}} day(s)) was {{decision}}. - {{school}}', true),
  (:'org_id','att.staff_leave_decided','sms','bn','আপনার {{leave}} ছুটি ({{from}} থেকে {{to}}, {{days}} দিন) {{decision}} হয়েছে। - {{school}}', true),
  (:'org_id','att.correction_decided','sms','en','Your attendance correction for {{student_name}} on {{date}} ({{register}}, to {{new_status}}) was {{decision}}. {{note}} - {{school}}', true),
  (:'org_id','att.correction_decided','sms','bn','{{student_name}}-এর {{date}} তারিখের হাজিরা সংশোধনের ({{register}}, {{new_status}}) অনুরোধ {{decision}} হয়েছে। {{note}} - {{school}}', true),
  (:'org_id','acc.requisition_decided','sms','en','Your purchase requisition {{pr_no}} ({{title}}) was {{decision}}. {{note}} - {{school}}', true),
  (:'org_id','acc.requisition_decided','sms','bn','আপনার ক্রয় অনুরোধ {{pr_no}} ({{title}}) {{decision}} হয়েছে। {{note}} - {{school}}', true),
  (:'org_id','acc.budget_decided','sms','en','The budget "{{budget_name}}" you submitted was {{decision}}. {{note}} - {{school}}', true),
  (:'org_id','acc.budget_decided','sms','bn','আপনার জমা দেওয়া বাজেট "{{budget_name}}" {{decision}} হয়েছে। {{note}} - {{school}}', true),
  (:'org_id','hrm.cpd_session_cancelled','sms','en','The training "{{title}}" on {{when}} has been cancelled: {{reason}}. - {{school}}', true),
  (:'org_id','hrm.cpd_session_cancelled','sms','bn','{{when}} তারিখের প্রশিক্ষণ "{{title}}" বাতিল করা হয়েছে: {{reason}}। - {{school}}', true),
  (:'org_id','adm.enquiry_received','sms','en','Dear {{guardian_name}}, thank you for your enquiry about {{child_name}} (ref {{reference}}). Our admission office will call you soon. - {{school}}', true),
  (:'org_id','adm.enquiry_received','sms','bn','প্রিয় {{guardian_name}}, {{child_name}}-এর ভর্তির বিষয়ে যোগাযোগের জন্য ধন্যবাদ (রেফ {{reference}})। আমাদের ভর্তি অফিস শীঘ্রই আপনাকে ফোন করবে। - {{school}}', true),
  (:'org_id','adm.application_submitted','sms','en','Dear {{guardian_name}}, the application for {{child_name}} is received. Application no {{reference}}. We will contact you about the next steps. - {{school}}', true),
  (:'org_id','adm.application_submitted','sms','bn','প্রিয় {{guardian_name}}, {{child_name}}-এর আবেদন গৃহীত হয়েছে। আবেদন নম্বর {{reference}}। পরবর্তী ধাপ সম্পর্কে আমরা যোগাযোগ করব। - {{school}}', true),
  (:'org_id','hrm.payslip_ready','sms','en','Your salary for {{month}} has been processed. See your payslip in the staff app. - {{school}}', true),
  (:'org_id','hrm.payslip_ready','sms','bn','{{month}} মাসের বেতন প্রক্রিয়া করা হয়েছে। স্টাফ অ্যাপে পে-স্লিপ দেখুন। - {{school}}', true),
  (:'org_id','trn.bus_near_pickup','sms','en','School bus {{vehicle}} ({{route}}) is about {{minutes}} min from {{stop}}. Please be at the stop. - {{school}}', true),
  (:'org_id','trn.bus_near_pickup','sms','bn','স্কুল বাস {{vehicle}} ({{route}}) {{stop}} থেকে প্রায় {{minutes}} মিনিট দূরে। অনুগ্রহ করে স্টপে থাকুন। - {{school}}', true),
  (:'org_id','trn.bus_near_drop','sms','en','School bus {{vehicle}} ({{route}}) will reach {{stop}} in about {{minutes}} min. - {{school}}', true),
  (:'org_id','trn.bus_near_drop','sms','bn','স্কুল বাস {{vehicle}} ({{route}}) প্রায় {{minutes}} মিনিটে {{stop}} পৌঁছাবে। - {{school}}', true),
  (:'org_id','lib.reservation_ready','sms','en','Library: "{{title}}" is ready for {{borrower_name}}. Collect it by {{expires}}. - {{school}}', true),
  (:'org_id','lib.reservation_ready','sms','bn','লাইব্রেরি: {{borrower_name}}-এর জন্য "{{title}}" বইটি প্রস্তুত। {{expires}}-এর মধ্যে সংগ্রহ করুন। - {{school}}', true)
ON CONFLICT (org_id, event_code, channel, locale, version) DO NOTHING;
