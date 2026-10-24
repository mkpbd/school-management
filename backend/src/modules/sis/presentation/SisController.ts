import { z } from 'zod';
import { BaseController, ifMatchVersion } from '../../../shared/http/BaseController.js';
import { zx } from '../../../shared/http/crud.js';
import { defineRoute, type RouteDefinition } from '../../../shared/http/RouteDefinition.js';
import type {
  AddGuardian,
  AttachStudentDocument,
  EnrolStudent,
  GetSectionRoster,
  GetStudent,
  RegisterStudent,
  SearchStudents,
  TransferStudent,
  UpdateStudent,
  VerifyStudentDocument,
} from '../application/StudentUseCases.js';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
const Id = z.object({ id: zx.uuid() });
const Relationship = z.enum([
  'father',
  'mother',
  'grandfather',
  'grandmother',
  'uncle',
  'aunt',
  'sibling',
  'legal_guardian',
  'other',
]);

const GuardianBody = z
  .object({
    fullNameEn: zx.name(),
    fullNameBn: z.string().max(200).optional(),
    phone: zx.phone(),
    altPhone: zx.phone().optional(),
    email: z.string().email().optional(),
    nid: z.string().min(10).max(17).optional(),
    occupationCode: z.string().max(30).optional(),
    preferredLocale: z.enum(['en', 'bn']).optional(),
    relationship: Relationship,
    isPrimaryContact: z.boolean().optional(),
    isFeePayer: z.boolean().optional(),
    canPickup: z.boolean().optional(),
    portalAccess: z.boolean().optional(),
  })
  .strict();

const StudentBody = z
  .object({
    firstNameEn: zx.name(),
    lastNameEn: z.string().max(100).optional(),
    fullNameBn: z.string().max(200).optional(),
    preferredName: z.string().max(100).optional(),
    gender: z.enum(['male', 'female']),
    dateOfBirth: zx.date(),
    birthCertNo: z.string().min(5).max(30).optional(),
    nationality: z.string().length(2).optional(),
    religion: z.string().max(30).optional(),
    bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
    motherTongue: z.string().max(30).optional(),
    previousSchool: z.string().max(200).optional(),
    /** CCA house (cca.house) */
    houseId: zx.uuid().nullable().optional(),
    admittedOn: zx.date(),
  })
  .strict();

/** SIS: students, guardians, enrolment, documents (SIS-01..04, 09). */
export class SisController extends BaseController {
  readonly basePath = '/sis';
  readonly tag = 'Students';

  routes(): RouteDefinition[] {
    return [
      defineRoute({
        method: 'post',
        path: '/students',
        summary: 'Register a student with guardians (family auto-linked by guardian phone) and optional enrolment',
        permission: 'sis.student.create',
        idempotent: true,
        schema: {
          body: z
            .object({
              campusId: zx.uuid().optional(),
              student: StudentBody,
              guardians: z.array(GuardianBody).min(1).max(6),
              enrolment: z
                .object({ classSectionId: zx.uuid(), rollNo: z.number().int().positive().optional() })
                .strict()
                .optional(),
            })
            .strict(),
        },
        handler: async ({ body }, req) => {
          const r = await this.resolve<RegisterStudent>(req, 'registerStudent').execute(body);
          return this.created(r, `/api/v1/sis/students/${r.student.id}`);
        },
      }),
      defineRoute({
        method: 'get',
        path: '/students',
        summary: 'Search students (scope-filtered: campus, own classes/subjects, own children)',
        permission: 'sis.student.view',
        schema: {
          query: z.object({
            campusId: zx.uuid().optional(),
            classSectionId: zx.uuid().optional(),
            status: z.enum(['active', 'on_hold', 'withdrawn', 'graduated', 'alumni']).optional(),
            q: z.string().max(100).optional(),
            birthCertNo: z.string().max(30).optional(),
            guardianPhone: zx.phone().optional(),
            limit: z.coerce.number().int().min(1).max(200).default(50),
            cursor: z.string().optional(),
          }),
        },
        handler: async ({ query }, req) =>
          this.page(await this.resolve<SearchStudents>(req, 'searchStudents').execute(query)),
      }),
      defineRoute({
        method: 'get',
        path: '/students/:id',
        summary: 'Student 360: profile, guardians, placement history, documents',
        auth: 'user',
        schema: { params: Id },
        handler: async ({ params }, req) => {
          const r = await this.resolve<GetStudent>(req, 'getStudent').execute(params);
          return this.withEtag(this.ok(r), r.student.rowVersion);
        },
      }),
      defineRoute({
        method: 'patch',
        path: '/students/:id',
        summary: 'Update a student profile (If-Match: "<rowVersion>")',
        permission: 'sis.student.edit',
        schema: {
          params: Id,
          body: StudentBody.omit({ admittedOn: true })
            .extend({ status: z.enum(['active', 'on_hold']) })
            .partial()
            .strict(),
        },
        handler: async ({ params, body }, req) => {
          const s = await this.resolve<UpdateStudent>(req, 'updateStudent').execute({
            id: params.id,
            patch: body,
            expectedVersion: ifMatchVersion(req),
          });
          return this.withEtag(this.ok(s), s.rowVersion);
        },
      }),
      defineRoute({
        method: 'post',
        path: '/students/:id/guardians',
        summary: 'Add or link a guardian (same family only)',
        permission: 'sis.guardian.create',
        schema: { params: Id, body: GuardianBody },
        handler: async ({ params, body }, req) =>
          this.created(
            await this.resolve<AddGuardian>(req, 'addGuardian').execute({ studentId: params.id, guardian: body }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/students/:id/enrolments',
        summary: 'Enrol in a class section (capacity + roll number; no overlapping placements)',
        permission: 'sis.enrolment.edit',
        schema: {
          params: Id,
          body: z
            .object({
              classSectionId: zx.uuid(),
              startsOn: zx.date().optional(),
              rollNo: z.number().int().positive().optional(),
            })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.created(
            await this.resolve<EnrolStudent>(req, 'enrolStudent').execute({
              studentId: params.id,
              classSectionId: body.classSectionId,
              startsOn: body.startsOn ?? today(),
              rollNo: body.rollNo,
            }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/students/:id/transfer',
        summary: 'Transfer to another section/campus from a date (history kept)',
        permission: 'sis.enrolment.approve',
        successStatus: 200,
        schema: {
          params: Id,
          body: z
            .object({ toClassSectionId: zx.uuid(), onDate: zx.date(), reason: z.string().min(3).max(300) })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<TransferStudent>(req, 'transferStudent').execute({ studentId: params.id, ...body }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/students/:id/documents',
        summary: 'Attach an uploaded, scanned file (purpose student_document) to the vault',
        permission: 'sis.document.create',
        schema: {
          params: Id,
          body: z
            .object({ docType: z.string().min(2).max(40), fileId: zx.uuid(), expiresOn: zx.date().optional() })
            .strict(),
        },
        handler: async ({ params, body }, req) =>
          this.created(
            await this.resolve<AttachStudentDocument>(req, 'attachStudentDocument').execute({
              studentId: params.id,
              ...body,
            }),
          ),
      }),
      defineRoute({
        method: 'post',
        path: '/documents/:id/verify',
        summary: 'Verify or reject a student document',
        permission: 'sis.document.approve',
        successStatus: 200,
        schema: { params: Id, body: z.object({ status: z.enum(['verified', 'rejected']) }).strict() },
        handler: async ({ params, body }, req) =>
          this.ok(
            await this.resolve<VerifyStudentDocument>(req, 'verifyStudentDocument').execute({
              documentId: params.id,
              status: body.status,
            }),
          ),
      }),
      defineRoute({
        method: 'get',
        path: '/sections/:id/roster',
        summary: 'Class roster on a date (roll order)',
        permission: 'sis.student.view',
        schema: { params: Id, query: z.object({ date: zx.date().optional() }) },
        handler: async ({ params, query }, req) =>
          this.ok(
            await this.resolve<GetSectionRoster>(req, 'getSectionRoster').execute({
              sectionId: params.id,
              onDate: query.date ?? today(),
            }),
          ),
      }),
    ];
  }
}
