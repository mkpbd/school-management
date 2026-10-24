import { client, unwrap } from "../client";
import type { Body, Query, Row } from "../types";

/** Users, roles and access control (backend/src/modules/iam/presentation/AccessController.ts). */
export const iam = {
  /** Permission catalogue grouped by module and resource (actions: view/create/edit/approve/export/delete). */
  permissions: <T = Row[]>() =>
    unwrap<T>(client.GET("/api/v1/iam/permissions")),
  /** Roles x permissions grid with the data scope of every grant (optionally one module). */
  roleMatrix: <T = Row>(query?: Query<"/api/v1/iam/role-matrix", "get">) =>
    unwrap<T>(client.GET("/api/v1/iam/role-matrix", { params: { query } })),
  roles: {
    /** Roles with number of permissions and users. */
    list: <T = Row[]>() => unwrap<T>(client.GET("/api/v1/iam/roles")),
    /** Role with its permissions (code + data scope). */
    get: <T = Row>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/iam/roles/{id}", { params: { path: { id } } }),
      ),
    /** Custom role, optionally copying the permissions of another. */
    create: <T = Row>(body: Body<"/api/v1/iam/roles", "post">) =>
      unwrap<T>(client.POST("/api/v1/iam/roles", { body })),
    /** Rename a role or require MFA for it. */
    update: <T = Row>(
      id: string,
      body: Body<"/api/v1/iam/roles/{id}", "patch">,
    ) =>
      unwrap<T>(
        client.PATCH("/api/v1/iam/roles/{id}", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Delete a custom role nobody holds. */
    remove: (id: string) =>
      unwrap<null>(
        client.DELETE("/api/v1/iam/roles/{id}", { params: { path: { id } } }),
      ),
    /** Replace the permissions of a role; answers with added / removed / rescoped codes and users affected. */
    setPermissions: <T = Row>(
      id: string,
      body: Body<"/api/v1/iam/roles/{id}/permissions", "put">,
    ) =>
      unwrap<T>(
        client.PUT("/api/v1/iam/roles/{id}/permissions", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  users: {
    /** Accounts with their roles (search by username / e-mail / phone). Offset paging (`limit`, `offset`). */
    list: <T = Row[]>(query?: Query<"/api/v1/iam/users", "get">) =>
      unwrap<T>(client.GET("/api/v1/iam/users", { params: { query } })),
    /** Role assignments and effective permissions of an account. */
    access: <T = Row>(id: string) =>
      unwrap<T>(
        client.GET("/api/v1/iam/users/{id}/access", {
          params: { path: { id } },
        }),
      ),
    /** Can this account do X (on this campus)? Answers with the roles that grant it. */
    check: <T = Row>(
      id: string,
      query: Query<"/api/v1/iam/users/{id}/check", "get">,
    ) =>
      unwrap<T>(
        client.GET("/api/v1/iam/users/{id}/check", {
          params: { path: { id }, query },
        }),
      ),
    /** Assign a role, organisation-wide (campusId null) or for one campus, optionally time-limited. */
    assignRole: <T = Row>(
      id: string,
      body: Body<"/api/v1/iam/users/{id}/roles", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/iam/users/{id}/roles", {
          params: { path: { id } },
          body,
        }),
      ),
    /** Disable or re-enable an account (takes effect on its next request). */
    setStatus: <T = Row>(
      id: string,
      body: Body<"/api/v1/iam/users/{id}/status", "post">,
    ) =>
      unwrap<T>(
        client.POST("/api/v1/iam/users/{id}/status", {
          params: { path: { id } },
          body,
        }),
      ),
  },
  roleAssignments: {
    /** Revoke a role assignment. */
    revoke: (id: string) =>
      unwrap<null>(
        client.DELETE("/api/v1/iam/role-assignments/{id}", {
          params: { path: { id } },
        }),
      ),
  },
};
