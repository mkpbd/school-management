import { client, unwrap } from "../client";
import { deletableResource, readOnlyResource, resource } from "../resource";
import type { Body, Query, Row } from "../types";

/** Academics (backend/src/modules/aca/presentation/AcaController.ts). */
export const aca = {
  programmes: resource("/api/v1/aca/programmes", "/api/v1/aca/programmes/{id}"),
  yearGroups: resource(
    "/api/v1/aca/year-groups",
    "/api/v1/aca/year-groups/{id}",
  ),
  subjects: resource("/api/v1/aca/subjects", "/api/v1/aca/subjects/{id}"),
  sections: {
    ...resource("/api/v1/aca/sections", "/api/v1/aca/sections/{id}"),
    /** Whole-section teaching groups for every compulsory curriculum subject (idempotent). */
    generateTeachingGroups: <T = Row>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/aca/sections/{id}/generate-teaching-groups", {
          params: { path: { id } },
        }),
      ),
  },
  curriculum: deletableResource(
    "/api/v1/aca/curriculum",
    "/api/v1/aca/curriculum/{id}",
  ),
  /** Elective option blocks of a programme (choose min..max subjects). */
  subjectGroups: resource(
    "/api/v1/aca/subject-groups",
    "/api/v1/aca/subject-groups/{id}",
  ),
  /** Read-only picker list until the EXM module manages grading schemes. */
  gradingSchemes: readOnlyResource(
    "/api/v1/aca/grading-schemes",
    "/api/v1/aca/grading-schemes/{id}",
  ),
  teachingGroups: {
    ...resource(
      "/api/v1/aca/teaching-groups",
      "/api/v1/aca/teaching-groups/{id}",
    ),
    /** Allocate a teacher (ACA-03). */
    setTeachers: <T = Row>(
      id: string,
      body: Body<"/api/v1/aca/teaching-groups/{id}/teachers", "put">,
    ) =>
      unwrap<T>(
        client.PUT("/api/v1/aca/teaching-groups/{id}/teachers", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Teachers allocated on a date (default today). */
    teachers: <T = Row[]>(
      id: string,
      query?: Query<"/api/v1/aca/teaching-groups/{id}/teachers", "get">,
    ) =>
      unwrap<T>(
        client.GET("/api/v1/aca/teaching-groups/{id}/teachers", {
          params: { path: { id }, query },
        }),
      ),
    /** End a teacher's allocation (default: from today). */
    endTeacher: <T = Row>(
      id: string,
      staffId: string,
      body: Body<
        "/api/v1/aca/teaching-groups/{id}/teachers/{staffId}/end",
        "post"
      > = {},
    ) =>
      unwrap<T>(
        client.POST("/api/v1/aca/teaching-groups/{id}/teachers/{staffId}/end", {
          params: { path: { id, staffId } },
          body,
        }),
      ),
    /** Current members (enrolments) of an explicit group; 422 GROUP_IS_WHOLE_SECTION otherwise. */
    members: <T = Row[]>(
      id: string,
      query?: Query<"/api/v1/aca/teaching-groups/{id}/members", "get">,
    ) =>
      unwrap<T>(
        client.GET("/api/v1/aca/teaching-groups/{id}/members", {
          params: { path: { id }, query },
        }),
      ),
    /** Members of an elective (explicit) group. */
    setMembers: <T = Row>(
      id: string,
      body: Body<"/api/v1/aca/teaching-groups/{id}/members", "put">,
    ) =>
      unwrap<T>(
        client.PUT("/api/v1/aca/teaching-groups/{id}/members", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  periods: deletableResource("/api/v1/aca/periods", "/api/v1/aca/periods/{id}"),
  timetables: {
    ...resource("/api/v1/aca/timetables", "/api/v1/aca/timetables/{id}"),
    /** Replace all slots of a draft timetable (clash-checked). */
    replaceSlots: <T = Row>(
      id: string,
      body: Body<"/api/v1/aca/timetables/{id}/slots", "put">,
    ) =>
      unwrap<T>(
        client.PUT("/api/v1/aca/timetables/{id}/slots", {
          params: { path: { id } },
          body,
        }),
      ),
    publish: <T = Row>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/aca/timetables/{id}/publish", {
          params: { path: { id } },
        }),
      ),
    /** View for a section, teacher or room. */
    view: <T = Row>(
      id: string,
      query: Query<"/api/v1/aca/timetables/{id}/view", "get">,
    ) =>
      unwrap<T>(
        client.GET("/api/v1/aca/timetables/{id}/view", {
          params: { path: { id }, query },
        }),
      ),
  },
  /** Allocated vs scheduled periods per teacher (ACA-03). */
  teacherLoad: <T = Row[]>(query: Query<"/api/v1/aca/teacher-load", "get">) =>
    unwrap<T>(client.GET("/api/v1/aca/teacher-load", { params: { query } })),
};
