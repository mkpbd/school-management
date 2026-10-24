import { z } from 'zod';
import {
  classSection,
  curriculumSubject,
  periodDefinition,
  programme,
  subject,
  subjectGroup,
  teachingGroup,
  timetable,
  yearGroup,
} from '../../../shared/infrastructure/db/schema/aca.js';
import { gradingScheme } from '../../../shared/infrastructure/db/schema/exm.js';
import { BaseController } from '../../../shared/http/BaseController.js';
import { crudRoutes, zx } from '../../../shared/http/crud.js';
import { defineRoute, type RouteDefinition } from '../../../shared/http/RouteDefinition.js';
import type {
  AssignTeacher,
  EndTeacher,
  GenerateSectionTeachingGroups,
  GetTimetableView,
  ListGroupMembers,
  ListGroupTeachers,
  PublishTimetable,
  SaveTimetableSlots,
  SetGroupMembers,
  TeacherLoadReport,
} from '../application/TeachingUseCases.js';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
const IdParam = z.object({ id: zx.uuid() });

/** ACA: academic structure, teaching groups and timetable (ACA-01..08). */
export class AcaController extends BaseController {
  readonly basePath = '/aca';
  readonly tag = 'Academics';

  routes(): RouteDefinition[] {
    return [
      ...crudRoutes({
        path: '/programmes',
        entity: 'programme',
        table: programme,
        orgScoped: true,
        permissions: { view: 'aca.structure.view', create: 'aca.structure.create', edit: 'aca.structure.edit' },
        orderBy: [programme.seq],
        createSchema: z.object({
          code: zx.code(),
          nameEn: zx.name(),
          nameBn: z.string().optional(),
          awardingBody: z.string().max(40).optional(),
          seq: z.number().int(),
        }),
        updateSchema: z.object({
          nameEn: zx.name(),
          nameBn: z.string().nullable(),
          defaultGradingSchemeId: zx.uuid().nullable(),
        }),
      }),
      ...crudRoutes({
        path: '/year-groups',
        entity: 'year group',
        table: yearGroup,
        permissions: { view: 'aca.structure.view', create: 'aca.structure.create', edit: 'aca.structure.edit' },
        filters: { programmeId: yearGroup.programmeId },
        orderBy: [yearGroup.seq],
        createSchema: z.object({
          programmeId: zx.uuid(),
          code: zx.code(),
          nameEn: zx.name(),
          nameBn: z.string().optional(),
          seq: z.number().int(),
          nextYearGroupId: zx.uuid().optional(),
          minAgeMonths: z.number().int().optional(),
          maxAgeMonths: z.number().int().optional(),
        }),
        updateSchema: z.object({
          nameEn: zx.name(),
          nameBn: z.string().nullable(),
          nextYearGroupId: zx.uuid().nullable(),
          minAgeMonths: z.number().int().nullable(),
          maxAgeMonths: z.number().int().nullable(),
        }),
      }),
      ...crudRoutes({
        path: '/subjects',
        entity: 'subject',
        table: subject,
        orgScoped: true,
        permissions: { view: 'aca.structure.view', create: 'aca.structure.create', edit: 'aca.structure.edit' },
        filters: { kind: subject.kind },
        search: [subject.code, subject.nameEn],
        orderBy: [subject.code],
        createSchema: z.object({
          code: zx.code(),
          nameEn: zx.name(),
          nameBn: z.string().optional(),
          kind: z.enum(['core', 'optional', 'elective', 'co_curricular', 'religious', 'language']),
          externalCode: z.string().max(20).optional(),
          isGraded: z.boolean().optional(),
        }),
        updateSchema: z.object({
          nameEn: zx.name(),
          nameBn: z.string().nullable(),
          externalCode: z.string().max(20).nullable(),
          isGraded: z.boolean(),
        }),
      }),
      ...crudRoutes({
        path: '/sections',
        entity: 'class section',
        table: classSection,
        orgScoped: true,
        campusScoped: true,
        permissions: { view: 'aca.structure.view', create: 'aca.structure.create', edit: 'aca.structure.edit' },
        filters: {
          campusId: classSection.campusId,
          academicYearId: classSection.academicYearId,
          yearGroupId: classSection.yearGroupId,
          classTeacherStaffId: classSection.classTeacherStaffId,
        },
        orderBy: [classSection.displayName],
        createSchema: z.object({
          campusId: zx.uuid().optional(),
          academicYearId: zx.uuid(),
          yearGroupId: zx.uuid(),
          shiftId: zx.uuid().optional(),
          name: z.string().min(1).max(30),
          displayName: zx.name(),
          classTeacherStaffId: zx.uuid().optional(),
          headOfSectionStaffId: zx.uuid().optional(),
          homeRoomId: zx.uuid().optional(),
          capacity: z.number().int().positive(),
          genderPolicy: z.enum(['mixed', 'boys', 'girls']).optional(),
        }),
        updateSchema: z.object({
          displayName: zx.name(),
          shiftId: zx.uuid().nullable(),
          classTeacherStaffId: zx.uuid().nullable(),
          headOfSectionStaffId: zx.uuid().nullable(),
          homeRoomId: zx.uuid().nullable(),
          capacity: z.number().int().positive(),
        }),
      }),
      ...crudRoutes({
        path: '/curriculum',
        entity: 'curriculum subject',
        table: curriculumSubject,
        permissions: {
          view: 'aca.structure.view',
          create: 'aca.structure.create',
          edit: 'aca.structure.edit',
          delete: 'aca.structure.edit',
        },
        filters: { academicYearId: curriculumSubject.academicYearId, yearGroupId: curriculumSubject.yearGroupId },
        orderBy: [curriculumSubject.reportOrder],
        createSchema: z.object({
          academicYearId: zx.uuid(),
          yearGroupId: zx.uuid(),
          subjectId: zx.uuid(),
          subjectGroupId: zx.uuid().optional(),
          periodsPerWeek: z.number().int().min(0).max(20).optional(),
          gradingSchemeId: zx.uuid().optional(),
          reportOrder: z.number().int().optional(),
        }),
        updateSchema: z.object({
          periodsPerWeek: z.number().int().min(0).max(20),
          gradingSchemeId: zx.uuid().nullable(),
          reportOrder: z.number().int(),
        }),
      }),
      ...crudRoutes({
        path: '/subject-groups',
        entity: 'subject group',
        table: subjectGroup,
        permissions: { view: 'aca.structure.view', create: 'aca.structure.create', edit: 'aca.structure.edit' },
        filters: { programmeId: subjectGroup.programmeId },
        search: [subjectGroup.code, subjectGroup.nameEn],
        orderBy: [subjectGroup.code],
        createSchema: z.object({
          programmeId: zx.uuid(),
          code: zx.code(),
          nameEn: zx.name(),
          minChoose: z.number().int().min(0).max(20).optional(),
          maxChoose: z.number().int().min(1).max(20).optional(),
          rules: z.record(z.string(), z.unknown()).optional(),
        }),
        updateSchema: z.object({
          nameEn: zx.name(),
          minChoose: z.number().int().min(0).max(20),
          maxChoose: z.number().int().min(1).max(20),
          rules: z.record(z.string(), z.unknown()),
        }),
      }),
      // Read-only until the EXM module owns grading schemes: curriculum and programmes pick from this list.
      ...crudRoutes({
        path: '/grading-schemes',
        entity: 'grading scheme',
        table: gradingScheme,
        permissions: { view: 'aca.structure.view' },
        filters: { kind: gradingScheme.kind, isActive: gradingScheme.isActive },
        search: [gradingScheme.code, gradingScheme.nameEn],
        orderBy: [gradingScheme.code, gradingScheme.version],
      }),
      ...crudRoutes({
        path: '/teaching-groups',
        entity: 'teaching group',
        table: teachingGroup,
        orgScoped: true,
        campusScoped: true,
        permissions: { view: 'aca.allocation.view', create: 'aca.allocation.edit', edit: 'aca.allocation.edit' },
        filters: {
          academicYearId: teachingGroup.academicYearId,
          classSectionId: teachingGroup.classSectionId,
          subjectId: teachingGroup.subjectId,
          yearGroupId: teachingGroup.yearGroupId,
        },
        orderBy: [teachingGroup.name],
        createSchema: z.object({
          campusId: zx.uuid().optional(),
          academicYearId: zx.uuid(),
          subjectId: zx.uuid(),
          yearGroupId: zx.uuid(),
          name: zx.name(),
          membership: z.enum(['whole_section', 'explicit']),
          classSectionId: zx.uuid().optional(),
        }),
        updateSchema: z.object({ name: zx.name() }),
      }),
      defineRoute({
        method: 'post',
        path: '/sections/:id/generate-teaching-groups',
        summary: 'Create whole-section teaching groups for every compulsory curriculum subject (idempotent)',
        permission: 'aca.allocation.edit',
        successStatus: 200,
        schema: { params: IdParam },
        handler: async ({ params }, req) =>
          this.ok(
            await this.resolve<GenerateSectionTeachingGroups>(req, 'generateSectionTeachingGroups').execute({
              sectionId: params.id,
            }),
          ),
      }),
      defineRoute({
        method: 'put',
        path: '/teaching-groups/:id/teachers',
        summary: 'Allocate a teacher to a teaching group (ACA-03)',
        permission: 'aca.allocation.edit',
        successStatus: 200,
        schema: {
          params: IdParam,
          body: z
            .object({
              staffId: zx.uuid(),
              role: z.enum(['main', 'assistant']).default('main'),
              periodsPerWeek: z.number().int().min(0).max(40).default(0),
              validFrom: zx.date().optional(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<AssignTeacher>(req, 'assignTeacher').execute({
              groupId: params.id,
              ...body,
              validFrom: body.validFrom ?? today(),
            }),
          ),
      }),
      defineRoute({
        method: 'put',
        path: '/teaching-groups/:id/members',
        summary: 'Set members of an elective (explicit) teaching group',
        permission: 'aca.allocation.edit',
        successStatus: 200,
        schema: {
          params: IdParam,
          body: z.object({ enrolmentIds: z.array(zx.uuid()).max(300), onDate: zx.date().optional() }).strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<SetGroupMembers>(req, 'setGroupMembers').execute({
              groupId: params.id,
              enrolmentIds: body.enrolmentIds,
              onDate: body.onDate ?? today(),
            }),
          ),
      }),
      defineRoute({
        method: 'get',
        path: '/teaching-groups/:id/teachers',
        summary: 'Teachers allocated to a teaching group on a date (default today)',
        permission: 'aca.allocation.view',
        schema: { params: IdParam, query: z.object({ onDate: zx.date().optional() }) },
        handler: async ({ params, query }, req) =>
          this.ok(
            await this.resolve<ListGroupTeachers>(req, 'listGroupTeachers').execute({
              groupId: params.id,
              onDate: query.onDate ?? today(),
            }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/teaching-groups/:id/teachers/:staffId/end',
        summary: "End a teacher's allocation to a teaching group (default: from today)",
        permission: 'aca.allocation.edit',
        successStatus: 200,
        schema: {
          params: z.object({ id: zx.uuid(), staffId: zx.uuid() }),
          body: z.object({ validTo: zx.date().optional() }).strict().default({}),
        },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<EndTeacher>(req, 'endTeacher').execute({
              groupId: params.id,
              staffId: params.staffId,
              validTo: body.validTo ?? today(),
            }),
          ),
      }),
      defineRoute({
        method: 'get',
        path: '/teaching-groups/:id/members',
        summary: 'Members (enrolments) of an explicit teaching group on a date (default today)',
        permission: 'aca.allocation.view',
        schema: { params: IdParam, query: z.object({ onDate: zx.date().optional() }) },
        handler: async ({ params, query }, req) =>
          this.ok(
            await this.resolve<ListGroupMembers>(req, 'listGroupMembers').execute({
              groupId: params.id,
              onDate: query.onDate ?? today(),
            }),
          ),
      }),
      ...crudRoutes({
        path: '/periods',
        entity: 'bell-schedule period',
        table: periodDefinition,
        orgScoped: true,
        campusScoped: true,
        permissions: {
          view: 'aca.timetable.view',
          create: 'aca.timetable.edit',
          edit: 'aca.timetable.edit',
          delete: 'aca.timetable.edit',
        },
        filters: {
          campusId: periodDefinition.campusId,
          shiftId: periodDefinition.shiftId,
          scheduleCode: periodDefinition.scheduleCode,
        },
        orderBy: [periodDefinition.periodNo],
        createSchema: z.object({
          campusId: zx.uuid().optional(),
          shiftId: zx.uuid(),
          scheduleCode: z.enum(['regular', 'ramadan']).optional(),
          periodNo: z.number().int().min(0).max(20),
          label: z.string().min(1).max(30),
          kind: z.enum(['teaching', 'break', 'prayer', 'assembly', 'registration']),
          startsAt: zx.time(),
          endsAt: zx.time(),
        }),
        updateSchema: z.object({ label: z.string().min(1).max(30), startsAt: zx.time(), endsAt: zx.time() }),
      }),
      ...crudRoutes({
        path: '/timetables',
        entity: 'timetable',
        table: timetable,
        orgScoped: true,
        campusScoped: true,
        permissions: { view: 'aca.timetable.view', create: 'aca.timetable.edit', edit: 'aca.timetable.edit' },
        filters: { campusId: timetable.campusId, academicYearId: timetable.academicYearId, status: timetable.status },
        createSchema: z.object({
          campusId: zx.uuid().optional(),
          academicYearId: zx.uuid(),
          name: zx.name(),
          effectiveFrom: zx.date(),
          effectiveTo: zx.date().optional(),
        }),
        updateSchema: z.object({ name: zx.name(), effectiveTo: zx.date().nullable() }),
      }),
      defineRoute({
        method: 'put',
        path: '/timetables/:id/slots',
        summary: 'Replace all slots of a draft timetable (clash-checked)',
        permission: 'aca.timetable.edit',
        successStatus: 200,
        schema: {
          params: IdParam,
          body: z
            .object({
              slots: z
                .array(
                  z.object({
                    dayOfWeek: z.number().int().min(0).max(6),
                    periodDefinitionId: zx.uuid(),
                    teachingGroupId: zx.uuid(),
                    staffId: zx.uuid(),
                    roomId: zx.uuid().nullable().optional(),
                  }),
                )
                .max(2000),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<SaveTimetableSlots>(req, 'saveTimetableSlots').execute({
              timetableId: params.id,
              slots: body.slots,
            }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/timetables/:id/publish',
        summary: 'Publish a draft timetable',
        permission: 'aca.timetable.approve',
        successStatus: 200,
        schema: { params: IdParam },
        handler: async ({ params }, req) =>
          this.ok(await this.resolve<PublishTimetable>(req, 'publishTimetable').execute({ timetableId: params.id })),
      }),
      defineRoute({
        method: 'get',
        path: '/timetables/:id/view',
        summary: 'Timetable view for a section, teacher or room',
        permission: 'aca.timetable.view',
        schema: {
          params: IdParam,
          query: z.object({
            classSectionId: zx.uuid().optional(),
            staffId: zx.uuid().optional(),
            roomId: zx.uuid().optional(),
          }),
        },
        handler: async ({ params, query }, req) =>
          this.ok(
            await this.resolve<GetTimetableView>(req, 'getTimetableView').execute({ timetableId: params.id, ...query }),
          ),
      }),
      defineRoute({
        method: 'get',
        path: '/teacher-load',
        summary: 'Teacher load: allocated vs scheduled periods (ACA-03)',
        permission: 'aca.allocation.view',
        schema: { query: z.object({ academicYearId: zx.uuid(), campusId: zx.uuid().optional() }) },
        handler: async ({ query }, req) =>
          this.ok(await this.resolve<TeacherLoadReport>(req, 'teacherLoadReport').execute(query)),
      }),
    ];
  }
}
