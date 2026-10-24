import { api, type Row } from "@/lib/api";

/**
 * Option sources for reference fields (`campusId`, `subjectId`, ...). Each one is cached by TanStack Query under
 * ["ref", key]; mutations invalidate ["ref"] so new rows appear in every select.
 */
export interface RefSource {
  key: string;
  load: () => Promise<Row[]>;
  label: (row: Row) => string;
}

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const named = (r: Row) =>
  `${s(r.nameEn ?? r.name ?? r.displayName ?? r.title)}${r.code ? ` (${s(r.code)})` : ""}`;

function ref(
  key: string,
  load: () => Promise<{ data: Row[] }>,
  label: (r: Row) => string = named,
): RefSource {
  return { key, load: async () => (await load()).data, label };
}

const ALL = { pageSize: 500 } as const;

export const refs = {
  campuses: ref("campuses", () => api.core.campuses.list(ALL)),
  academicYears: ref(
    "academicYears",
    () => api.core.academicYears.list(ALL),
    (r) => `${s(r.code)}${r.isCurrent ? " (current)" : ""}`,
  ),
  terms: ref("terms", () => api.core.terms.list(ALL)),
  shifts: ref("shifts", () => api.core.shifts.list(ALL)),
  rooms: ref("rooms", () => api.core.rooms.list(ALL)),
  departments: ref("departments", () => api.hrm.departments.list(ALL)),
  designations: ref("designations", () => api.hrm.designations.list(ALL)),
  staff: ref(
    "staff",
    () => api.hrm.staff.search({ limit: 200 }),
    (r) => `${s(r.fullNameEn)} (${s(r.staffNo)})`,
  ),
  cpdCourses: ref(
    "cpdCourses",
    () => api.hrm.cpdCourses.list(ALL),
    (r) => `${s(r.title)} (${Number(r.hours)} h)`,
  ),
  programmes: ref("programmes", () => api.aca.programmes.list(ALL)),
  yearGroups: ref("yearGroups", () => api.aca.yearGroups.list(ALL)),
  subjects: ref("subjects", () => api.aca.subjects.list(ALL)),
  subjectGroups: ref("subjectGroups", () => api.aca.subjectGroups.list(ALL)),
  gradingSchemes: ref(
    "gradingSchemes",
    () => api.aca.gradingSchemes.list({ ...ALL, isActive: "true" }),
    (r) => `${s(r.nameEn)} (${s(r.code)} v${s(r.version)})`,
  ),
  sections: ref(
    "sections",
    () => api.aca.sections.list(ALL),
    (r) => s(r.displayName ?? r.name),
  ),
  teachingGroups: ref(
    "teachingGroups",
    () => api.aca.teachingGroups.list(ALL),
    (r) => s(r.name),
  ),
  periods: ref(
    "periods",
    () => api.aca.periods.list(ALL),
    (r) =>
      `${s(r.label)} ${s(r.startsAt).slice(0, 5)}–${s(r.endsAt).slice(0, 5)}`,
  ),
  timetables: ref(
    "timetables",
    () => api.aca.timetables.list(ALL),
    (r) => s(r.name),
  ),
  feeHeads: ref("feeHeads", () => api.fee.heads.list(ALL)),
  concessionTypes: ref("concessionTypes", () =>
    api.fee.concessionTypes.list(ALL),
  ),
  houses: ref("houses", () => api.cca.houses.list(ALL)),
  students: ref(
    "students",
    () => api.sis.students.search({ limit: 200 }),
    (r) => `${s(r.fullNameEn)} (${s(r.admissionNo)})`,
  ),
} satisfies Record<string, RefSource>;
