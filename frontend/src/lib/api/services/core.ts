import { client, unwrap } from "../client";
import { deletableResource, resource } from "../resource";
import type { Body, Query, Row } from "../types";

/** CORE master data (backend/src/modules/core/presentation/CoreController.ts). */
export const core = {
  campuses: resource("/api/v1/core/campuses", "/api/v1/core/campuses/{id}"),
  academicYears: {
    ...resource(
      "/api/v1/core/academic-years",
      "/api/v1/core/academic-years/{id}",
    ),
    /** Mark an open academic year as the current one. */
    makeCurrent: <T = Row>(id: string) =>
      unwrap<T>(
        client.POST("/api/v1/core/academic-years/{id}/make-current", {
          params: { path: { id } },
        }),
      ),
  },
  terms: deletableResource("/api/v1/core/terms", "/api/v1/core/terms/{id}"),
  shifts: resource("/api/v1/core/shifts", "/api/v1/core/shifts/{id}"),
  rooms: deletableResource("/api/v1/core/rooms", "/api/v1/core/rooms/{id}"),
  calendarEvents: deletableResource(
    "/api/v1/core/calendar-events",
    "/api/v1/core/calendar-events/{id}",
  ),
  lookups: resource("/api/v1/core/lookups", "/api/v1/core/lookups/{id}"),
  settings: {
    /** Organisation defaults + campus overrides. */
    list: <T = Record<string, unknown>>(
      query?: Query<"/api/v1/core/settings", "get">,
    ) => unwrap<T>(client.GET("/api/v1/core/settings", { params: { query } })),
    /** Organisation default, or a campus override when `campusId` is given. */
    set: <T = Row>(
      key: string,
      body: Body<"/api/v1/core/settings/{key}", "put">,
    ) =>
      unwrap<T>(
        client.PUT("/api/v1/core/settings/{key}", {
          params: { path: { key } },
          body,
        }),
      ),
  },
  /** Is today (or `date`) a school day for a campus? */
  today: <T = Row>(query: Query<"/api/v1/core/today", "get">) =>
    unwrap<T>(client.GET("/api/v1/core/today", { params: { query } })),
};
