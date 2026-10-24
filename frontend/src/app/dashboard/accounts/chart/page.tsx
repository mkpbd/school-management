"use client";

import { BookOpenIcon } from "lucide-react";
import Link from "next/link";
import { ACCOUNT_KINDS, groupAccountsRef } from "@/components/acc/accounting";
import { ResourcePage } from "@/components/crud/resource-page";
import { StatusBadge } from "@/components/page";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { humanize } from "@/lib/format";

export default function ChartOfAccountsPage() {
  return (
    <ResourcePage
      title="Chart of accounts"
      description="Numeric codes (3–8 digits). Group accounts collect postable accounts; only postable, active accounts take journal lines. The code and kind cannot change — deactivate an account instead."
      queryKey="acc.accounts"
      entity="account"
      resource={api.acc.accounts}
      permissions={{ create: "acc.journal.create", edit: "acc.journal.create" }}
      filters={[
        {
          name: "kind",
          label: "Kinds",
          type: "select",
          options: ACCOUNT_KINDS,
        },
        { name: "isPostable", label: "Postable", type: "bool" },
        { name: "isActive", label: "Active", type: "bool" },
      ]}
      columns={[
        { key: "code", label: "Code", type: "mono" },
        {
          key: "nameEn",
          label: "Name",
          render: (r) => (
            <div>
              <div className={r.isPostable ? "" : "font-semibold"}>
                {String(r.nameEn)}
              </div>
              {typeof r.nameBn === "string" && r.nameBn && (
                <div className="text-xs text-muted-foreground">{r.nameBn}</div>
              )}
            </div>
          ),
        },
        { key: "kind", label: "Kind", render: (r) => humanize(r.kind) },
        { key: "parentId", label: "Parent", ref: groupAccountsRef },
        { key: "isPostable", label: "Postable", type: "bool" },
        {
          key: "flags",
          label: "Cash / bank",
          render: (r) =>
            r.isCash ? (
              "Cash"
            ) : r.isBank ? (
              "Bank"
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
        },
        {
          key: "isActive",
          label: "Status",
          render: (r) => (
            <StatusBadge status={r.isActive ? "active" : "inactive"} />
          ),
        },
      ]}
      rowActions={(r) =>
        r.isPostable ? (
          <Button
            nativeButton={false}
            variant="ghost"
            size="xs"
            render={
              <Link
                href={`/dashboard/accounts/ledger?accountId=${String(r.id)}`}
              />
            }
          >
            <BookOpenIcon /> Ledger
          </Button>
        ) : null
      }
      fields={[
        {
          name: "code",
          label: "Code",
          required: true,
          mode: "create",
          placeholder: "5100",
          help: "3–8 digits, e.g. 1xxx assets, 4xxx income, 5xxx expenses",
        },
        {
          name: "kind",
          label: "Kind",
          type: "select",
          options: ACCOUNT_KINDS,
          required: true,
          mode: "create",
        },
        { name: "nameEn", label: "Name", required: true },
        { name: "nameBn", label: "Name (Bangla)", nullable: true },
        {
          name: "parentId",
          label: "Parent (group account)",
          type: "ref",
          ref: groupAccountsRef,
          mode: "create",
        },
        {
          name: "isPostable",
          label: "Postable",
          type: "boolean",
          defaultValue: true,
          mode: "create",
          help: "Off for group / header accounts",
        },
        {
          name: "isCash",
          label: "Cash account",
          type: "boolean",
          mode: "create",
        },
        {
          name: "isBank",
          label: "Bank account",
          type: "boolean",
          mode: "create",
        },
        {
          name: "isActive",
          label: "Active",
          type: "boolean",
          mode: "edit",
          help: "Inactive accounts take no postings",
        },
      ]}
    />
  );
}
