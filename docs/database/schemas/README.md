# Data dictionary

Generated from the live database by `db/tools/gen_docs.py`.

| Schema | Purpose | Tables | Columns | FKs |
|---|---|---|---|---|
| [`core`](core.md) | CORE: organisation, campuses, academic calendar, settings, numbering | 12 | 132 | 19 |
| [`iam`](iam.md) | CORE: identity & access (users, roles, permissions, sessions, consent) | 10 | 105 | 16 |
| [`audit`](audit.md) | CORE: append-only, hash-sealed audit trail | 2 | 22 | 0 |
| [`wf`](wf.md) | CORE: configurable multi-step approval workflows | 6 | 61 | 11 |
| [`sys`](sys.md) | Platform plumbing: outbox, idempotency, files, imports, jobs | 7 | 69 | 8 |
| [`search`](search.md) | CORE: global search read model fed by domain events | 1 | 10 | 0 |
| [`sis`](sis.md) | SIS: students, guardians, families, enrolment history | 13 | 184 | 44 |
| [`adm`](adm.md) | ADM: enquiry, application, tests, merit list, offers | 11 | 134 | 34 |
| [`aca`](aca.md) | ACA: programmes, classes, subjects, teaching groups, timetable | 15 | 160 | 46 |
| [`att`](att.md) | ATT: student & staff attendance, devices, leave | 11 | 136 | 41 |
| [`lrn`](lrn.md) | LRN: homework, diary, resources, gradebook, quizzes | 14 | 209 | 54 |
| [`exm`](exm.md) | EXM: exams, marks, grading, results, report cards, Edexcel | 19 | 212 | 67 |
| [`fee`](fee.md) | FEE: fee structures, invoices, payments, gateways, reconciliation | 20 | 275 | 68 |
| [`acc`](acc.md) | ACC: chart of accounts, journals, budgets, procurement | 15 | 170 | 46 |
| [`hrm`](hrm.md) | HRM: staff, contracts, payroll, recruitment, appraisal | 23 | 252 | 60 |
| [`com`](com.md) | COM: notices, templates, notification hub, messaging | 22 | 218 | 35 |
| [`prt`](prt.md) | PRT: online forms and consents for portals | 2 | 30 | 8 |
| [`doc`](doc.md) | DOC: certificate/letter templates and issue register | 2 | 35 | 7 |
| [`web`](web.md) | WEB: public website CMS data and API clients | 4 | 43 | 7 |
| [`bi`](bi.md) | BI: pre-aggregated KPI tables and saved reports | 5 | 55 | 9 |
| [`trn`](trn.md) | TRN: vehicles, routes, stops, transport assignment, GPS | 13 | 113 | 32 |
| [`lib`](lib.md) | LIB: catalogue, copies, circulation, reservations | 8 | 91 | 22 |
| [`inv`](inv.md) | INV: items, stores, stock ledger, POS, assets, maintenance | 13 | 142 | 38 |
| [`hlt`](hlt.md) | HLT: health, sick bay, behaviour, counselling, safeguarding | 10 | 134 | 24 |
| [`cca`](cca.md) | CCA: houses, clubs, events, awards, Islamic values programme | 14 | 142 | 39 |
| [`sec`](sec.md) | SEC: visitors, safe pick-up, gate events, drills | 8 | 89 | 24 |

**Total:** 280 tables, 3228 columns, 759 foreign keys, 293 check constraints, 7 exclusion constraints, 487 secondary indexes, 194 triggers.
