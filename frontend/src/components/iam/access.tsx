"use client";

import { useQuery } from "@tanstack/react-query";
import { InfoIcon } from "lucide-react";
import type { ReactNode } from "react";
import { api, ApiError, isApiError, type DataScope, type Row } from "@/lib/api";
import type { RefSource } from "@/lib/refs";

// ---- contract shapes (backend/src/modules/iam/application/AccessControlUseCases.ts) ----

export const SCOPES = [
  "org",
  "campus",
  "section",
  "own_classes",
  "own_subjects",
  "own_children",
  "self",
] as const;
export const ACTIONS = [
  "view",
  "create",
  "edit",
  "approve",
  "export",
  "delete",
] as const;
export const USER_TYPES = ["staff", "guardian", "student"] as const;
export const USER_STATUSES = [
  "invited",
  "active",
  "locked",
  "disabled",
] as const;
export type UserType = (typeof USER_TYPES)[number] | "system";

/** Widest to narrowest; label + what the holder sees. */
export const SCOPE_INFO: Record<
  DataScope,
  { label: string; short: string; help: string; tone: string }
> = {
  org: {
    label: "Organisation",
    short: "Org",
    help: "Every campus",
    tone: "badge-primary",
  },
  campus: {
    label: "Campus",
    short: "Campus",
    help: "The campus of the assignment",
    tone: "badge-info",
  },
  section: {
    label: "Section",
    short: "Section",
    help: "Own section(s), e.g. head of section",
    tone: "badge-accent",
  },
  own_classes: {
    label: "Own classes",
    short: "Classes",
    help: "Classes the person teaches / is class teacher of",
    tone: "badge-secondary",
  },
  own_subjects: {
    label: "Own subjects",
    short: "Subjects",
    help: "Subjects the person teaches",
    tone: "badge-secondary",
  },
  own_children: {
    label: "Own children",
    short: "Children",
    help: "A guardian's own children",
    tone: "badge-warning",
  },
  self: {
    label: "Self",
    short: "Self",
    help: "Only the person's own records",
    tone: "badge-neutral",
  },
};

export interface PermissionGroup {
  module: string;
  resources: Array<{
    resource: string;
    actions: Array<{ code: string; action: string; isSensitive: boolean }>;
  }>;
}

export interface PermissionRow {
  [key: string]: unknown;
  code: string;
  module: string;
  resource: string;
  action: string;
  isSensitive: boolean;
  description: string | null;
}

export interface RoleView {
  [key: string]: unknown;
  id: string;
  code: string;
  nameEn: string;
  nameBn: string | null;
  isSystem: boolean;
  requiresMfa: boolean;
}

export interface RoleListItem extends RoleView {
  permissionCount: number;
  userCount: number;
}

export interface RoleGrant {
  code: string;
  scope: DataScope;
}

export interface RoleDetail extends RoleView {
  permissions: RoleGrant[];
}

export interface PermissionChange {
  role: RoleView;
  added: string[];
  removed: string[];
  rescoped: string[];
  sensitiveAdded: string[];
  usersAffected: number;
}

export interface RoleMatrixView {
  roles: RoleView[];
  permissions: PermissionRow[];
  /** role code -> permission code -> scope */
  cells: Record<string, Record<string, DataScope>>;
}

export interface AccountRow {
  [key: string]: unknown;
  id: string;
  userType: UserType;
  username: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  lastLoginAt: string | null;
}

export interface AccountListItem extends AccountRow {
  roles: Array<{ code: string; campusId: string | null }>;
}

export interface Assignment {
  [key: string]: unknown;
  id: string;
  userId: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  scopeType: "org" | "campus";
  campusId: string | null;
  validFrom: string;
  validTo: string | null;
  grantedBy: string | null;
  active: boolean;
}

export interface Grant {
  scope: DataScope;
  campusId: string | null;
  viaRole: string;
}

export interface UserAccess {
  user: AccountRow;
  assignments: Assignment[];
  /** permission code -> where it applies */
  permissions: Record<string, Grant[]>;
}

export interface AccessCheck {
  allowed: boolean;
  via: Grant[];
}

/** Which kind of account a role is for (mirrors userTypeForRole in the backend). */
export function userTypeForRole(code: string): UserType {
  return code === "PARENT"
    ? "guardian"
    : code === "STUDENT"
      ? "student"
      : "staff";
}

/** username, else e-mail, else phone. */
export function accountName(
  u: Pick<AccountRow, "username" | "email" | "phone">,
): string {
  return u.username ?? u.email ?? u.phone ?? "Account";
}

// ---- friendly errors ----

const MESSAGES: Record<string, (detail: string) => string> = {
  SELF_ROLE_EDIT: () =>
    "You hold this role, so you cannot change its permissions (no self-escalation). Ask another administrator.",
  SELF_ASSIGNMENT: () =>
    "You cannot change your own roles. Ask another administrator.",
  SELF_STATUS: () => "You cannot disable your own account.",
  LAST_ADMIN: () =>
    "Nobody else could administer access after this change. Give another active account a role with iam.role.edit first.",
  ROLE_USER_TYPE: (d) =>
    `This role is for a different kind of account (PARENT for guardians, STUDENT for students, the rest for staff): ${d}`,
  ROLE_ALREADY_ASSIGNED: () =>
    "The user already has this role there (same campus or organisation-wide). Revoke the old assignment to change its dates.",
  SYSTEM_ROLE: () =>
    "Built-in roles cannot be deleted. You can still change their permissions.",
  ROLE_IN_USE: () =>
    "Someone still holds this role. Revoke it from every user first (Users, filtered by this role).",
  ORG_WIDE_NOT_ALLOWED: () =>
    "Only organisation-wide administrators can grant or revoke organisation-wide roles. Choose a campus instead.",
  ROLE_EXISTS: () => "A role with this code already exists.",
  ROLE_CODE_INVALID: () =>
    "Role code: 3–40 capitals, digits or underscores, starting with a letter (e.g. EXAM_CLERK).",
  DATE_RANGE_INVALID: () => "The end date is before the start date.",
  OUT_OF_SCOPE: () => "That campus is not one of yours.",
};

/** Re-throws access-control API errors with a message the administrator can act on (field errors are kept). */
export async function friendly<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (err) {
    const message =
      isApiError(err) && err.problem ? MESSAGES[err.code] : undefined;
    if (isApiError(err) && err.problem && message)
      throw new ApiError(err.status, {
        ...err.problem,
        detail: message(err.message),
      });
    throw err;
  }
}

// ---- data ----

export const permissionsQueryKey = ["iam.permissions"] as const;

/** Permission catalogue (rarely changes). */
export function usePermissionCatalogue() {
  return useQuery({
    queryKey: permissionsQueryKey,
    queryFn: async () => (await api.iam.permissions<PermissionGroup[]>()).data,
    staleTime: 10 * 60_000,
  });
}

/** Role options for selects (cached under ["ref", "iam.roles"], refreshed after every mutation). */
export const roleRef: RefSource = {
  key: "iam.roles",
  load: async () => (await api.iam.roles.list<Row[]>()).data,
  label: (r) => `${String(r.nameEn)} (${String(r.code)})`,
};

// ---- presentation ----

export function ScopeBadge({
  scope,
  long,
}: {
  scope: DataScope;
  long?: boolean;
}) {
  const info = SCOPE_INFO[scope] ?? {
    label: scope,
    short: scope,
    help: "",
    tone: "badge-ghost",
  };
  return (
    <span
      className={`badge badge-soft badge-sm whitespace-nowrap ${info.tone}`}
      title={`${info.label}: ${info.help}`}
    >
      {long ? info.label : info.short}
    </span>
  );
}

export function ScopeLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {SCOPES.map((s) => (
        <span key={s} className="flex items-center gap-1">
          <ScopeBadge scope={s} /> {SCOPE_INFO[s].help}
        </span>
      ))}
    </div>
  );
}

/** Native select of data scopes. */
export function ScopeSelect({
  value,
  onChange,
  disabled,
  size = "xs",
  ...rest
}: {
  value: DataScope;
  onChange: (scope: DataScope) => void;
  disabled?: boolean;
  size?: "xs" | "sm";
  "aria-label"?: string;
}) {
  return (
    <select
      className={`select ${size === "xs" ? "select-xs h-6" : "select-sm h-8"} w-full`}
      value={value}
      disabled={disabled}
      aria-label={rest["aria-label"] ?? "Data scope"}
      onChange={(e) => onChange(e.target.value as DataScope)}
    >
      {SCOPES.map((s) => (
        <option key={s} value={s} title={SCOPE_INFO[s].help}>
          {SCOPE_INFO[s].label}
        </option>
      ))}
    </select>
  );
}

/** Changes to roles, assignments and account status reach holders on their next request. */
export function NextRequestNotice({ children }: { children?: ReactNode }) {
  return (
    <div role="note" className="alert alert-info alert-soft mb-4 text-sm">
      <InfoIcon className="size-4" />
      <span>
        {children ??
          "Changes here apply to the affected users on their next request: their cached permissions are cleared, no sign-out needed."}
      </span>
    </div>
  );
}
