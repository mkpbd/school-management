"use client";

import { ResourcePage } from "@/components/crud/resource-page";
import { api } from "@/lib/api";
import { refs } from "@/lib/refs";

export default function CurriculumPage() {
  return (
    <ResourcePage
      title="Curriculum"
      description="Subjects taught to a year group in an academic year, with periods per week and report order."
      queryKey="aca.curriculum"
      entity="curriculum subject"
      resource={api.aca.curriculum}
      searchable={false}
      permissions={{
        create: "aca.structure.create",
        edit: "aca.structure.edit",
        delete: "aca.structure.edit",
      }}
      filters={[
        {
          name: "academicYearId",
          label: "Years",
          type: "ref",
          ref: refs.academicYears,
        },
        {
          name: "yearGroupId",
          label: "Year groups",
          type: "ref",
          ref: refs.yearGroups,
        },
      ]}
      columns={[
        { key: "academicYearId", label: "Year", ref: refs.academicYears },
        { key: "yearGroupId", label: "Year group", ref: refs.yearGroups },
        { key: "subjectId", label: "Subject", ref: refs.subjects },
        {
          key: "subjectGroupId",
          label: "Option block",
          ref: refs.subjectGroups,
        },
        { key: "periodsPerWeek", label: "Periods / week" },
        { key: "gradingSchemeId", label: "Grading", ref: refs.gradingSchemes },
        { key: "reportOrder", label: "Report order" },
      ]}
      fields={[
        {
          name: "academicYearId",
          label: "Academic year",
          type: "ref",
          ref: refs.academicYears,
          required: true,
          mode: "create",
        },
        {
          name: "yearGroupId",
          label: "Year group",
          type: "ref",
          ref: refs.yearGroups,
          required: true,
          mode: "create",
        },
        {
          name: "subjectId",
          label: "Subject",
          type: "ref",
          ref: refs.subjects,
          required: true,
          mode: "create",
        },
        {
          name: "subjectGroupId",
          label: "Option block",
          type: "ref",
          ref: refs.subjectGroups,
          mode: "create",
          help: "Elective block (Academics → Subject groups); empty for core subjects",
        },
        {
          name: "gradingSchemeId",
          label: "Grading scheme",
          type: "ref",
          ref: refs.gradingSchemes,
          nullable: true,
          help: "Empty: the programme default",
        },
        {
          name: "periodsPerWeek",
          label: "Periods per week",
          type: "number",
          help: "0–20",
        },
        { name: "reportOrder", label: "Report card order", type: "number" },
      ]}
    />
  );
}
