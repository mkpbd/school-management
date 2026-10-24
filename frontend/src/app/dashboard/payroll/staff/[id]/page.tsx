"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  LandmarkIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { FormDialog } from "@/components/crud/form-dialog";
import {
  ConfirmButton,
  DetailList,
  Empty,
  ErrorAlert,
  Loading,
  PageHeader,
  StatusBadge,
} from "@/components/page";
import {
  componentValue,
  ContractDialog,
  TAX_CATEGORIES,
  useTaxYears,
  type ContractDialogMode,
  type ContractView,
  type LoanView,
} from "@/components/payroll/setup";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api, type Row } from "@/lib/api";
import { formatDate, formatMoney, humanize, todayISO } from "@/lib/format";

export default function StaffPayProfilePage() {
  const { id } = useParams<{ id: string }>();
  const staff = useQuery({
    queryKey: ["hrm.staff", id],
    queryFn: () => api.hrm.staff.get(id),
  });
  const s = staff.data?.data;

  return (
    <>
      <Button
        nativeButton={false}
        variant="link"
        size="sm"
        className="mb-2 px-0"
        render={<Link href="/dashboard/payroll/staff" />}
      >
        <ArrowLeftIcon /> Staff pay
      </Button>
      {staff.isError ? (
        <ErrorAlert error={staff.error} />
      ) : staff.isPending ? (
        <Loading />
      ) : (
        <>
          <PageHeader
            title={String(s?.fullNameEn ?? "Staff member")}
            description={
              <>
                {String(s?.staffNo ?? "")} · {humanize(s?.staffType)} · joined{" "}
                {formatDate(s?.joinedOn)} <StatusBadge status={s?.status} />
              </>
            }
          />
          <Tabs defaultValue="contracts">
            <TabsList>
              <TabsTrigger value="contracts">Contracts</TabsTrigger>
              <TabsTrigger value="bank">Bank account</TabsTrigger>
              <TabsTrigger value="loans">Loans &amp; advances</TabsTrigger>
              <TabsTrigger value="tax">Tax profile</TabsTrigger>
            </TabsList>
            <TabsContent value="contracts">
              <ContractsTab staffId={id} />
            </TabsContent>
            <TabsContent value="bank">
              <BankTab staffId={id} />
            </TabsContent>
            <TabsContent value="loans">
              <LoansTab staffId={id} />
            </TabsContent>
            <TabsContent value="tax">
              <TaxTab staffId={id} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </>
  );
}

function ContractsTab({ staffId }: { staffId: string }) {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<ContractDialogMode | null>(null);
  const contracts = useQuery({
    queryKey: ["hrm.contracts", staffId],
    queryFn: () => api.hrm.staff.contracts<ContractView[]>(staffId),
  });
  const canEdit = can(me, "hrm.payroll.create");

  const rows = [...(contracts.data?.data ?? [])].sort((a, b) =>
    b.startsOn.localeCompare(a.startsOn),
  );
  const today = contracts.data ? todayISO() : "";
  const isCurrent = (c: ContractView) =>
    c.startsOn <= today && (!c.endsOn || c.endsOn >= today);
  const current = rows.find(isCurrent);
  // the latest open-ended / still running contract can be revised
  const revisable = rows.find((c) => !c.endsOn || c.endsOn >= today);

  return (
    <Card>
      <CardHeader className="sm:flex sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Contracts</CardTitle>
          <CardDescription>
            Basic pay and components per period. Contracts never overlap.
          </CardDescription>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            {revisable && (
              <Button
                variant="outline"
                onClick={() =>
                  setDialog({ kind: "revise", contract: revisable })
                }
              >
                <PencilIcon /> Revise salary
              </Button>
            )}
            <Button onClick={() => setDialog({ kind: "create", staffId })}>
              <PlusIcon /> New contract
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {contracts.isError ? (
          <ErrorAlert error={contracts.error} />
        ) : contracts.isPending ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty>
            No contract yet — this staff member is skipped by payroll until one
            exists.
          </Empty>
        ) : (
          rows.map((c) => (
            <div key={c.id} className="rounded-lg border p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="font-medium">{humanize(c.contractType)}</span>
                <span className="text-sm text-muted-foreground">
                  {formatDate(c.startsOn)} –{" "}
                  {c.endsOn ? formatDate(c.endsOn) : "open-ended"}
                </span>
                {c === current && <Badge>Current</Badge>}
                {c.probationEndsOn && (
                  <span className="badge badge-soft badge-warning badge-sm">
                    Probation until {formatDate(c.probationEndsOn)}
                  </span>
                )}
              </div>
              <DetailList
                items={[
                  [
                    "Basic pay",
                    <span key="b" className="tabular-nums">
                      {formatMoney(c.basicPaisa)}
                    </span>,
                  ],
                  ...c.components.map(
                    (x) =>
                      [
                        x.code,
                        <span key={x.code} className="tabular-nums">
                          {componentValue(x)}
                        </span>,
                      ] as [string, React.ReactNode],
                  ),
                ]}
              />
            </div>
          ))
        )}
      </CardContent>
      <ContractDialog
        mode={dialog}
        onOpenChange={(open) => !open && setDialog(null)}
        onSaved={() =>
          void queryClient.invalidateQueries({
            queryKey: ["hrm.contracts", staffId],
          })
        }
      />
    </Card>
  );
}

function BankTab({ staffId }: { staffId: string }) {
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const [last4, setLast4] = useState<string | null | undefined>(undefined);
  const canEdit = can(me, "hrm.staff.edit");
  const save = useAction(
    (account: Row | null) =>
      api.hrm.staff.setBankAccount<{
        staffId: string;
        accountNoLast4: string | null;
      }>(staffId, {
        account: account as never,
      }),
    { onSuccess: (r) => setLast4(r.data.accountNoLast4), toastError: false },
  );
  const remove = useAction(
    () =>
      api.hrm.staff.setBankAccount<{ accountNoLast4: string | null }>(staffId, {
        account: null,
      }),
    { success: "Bank account removed", onSuccess: () => setLast4(null) },
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LandmarkIcon className="size-4" /> Salary bank account
        </CardTitle>
        <CardDescription>
          Stored encrypted and used only for the bank advice file. It is never
          shown again after saving — enter the full details to replace it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {last4 !== undefined && (
          <div role="status" className="alert alert-success alert-soft text-sm">
            {last4
              ? `Saved: account ending ${last4}.`
              : "No bank account on file."}
          </div>
        )}
        {canEdit ? (
          <div className="flex gap-2">
            <Button onClick={() => setOpen(true)}>Set bank account</Button>
            <ConfirmButton
              title="Remove the bank account?"
              description="The staff member will be listed as missing in the bank advice until a new account is set."
              confirmLabel="Remove"
              destructive
              size="default"
              onConfirm={() => remove.mutateAsync(undefined)}
            >
              <Trash2Icon /> Remove
            </ConfirmButton>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            You need the hrm.staff.edit permission to change it.
          </p>
        )}
      </CardContent>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Salary bank account"
        description="Replaces any account on file."
        submitLabel="Save"
        successMessage="Bank account saved"
        fields={[
          { name: "bankName", label: "Bank", required: true },
          { name: "branchName", label: "Branch", required: true },
          {
            name: "routingNo",
            label: "Routing number",
            required: true,
            help: "9 digits",
          },
          { name: "accountName", label: "Account name", required: true },
          {
            name: "accountNo",
            label: "Account number",
            required: true,
            help: "6–20 digits",
            wide: true,
          },
        ]}
        onSubmit={(body) => save.mutateAsync(body)}
      />
    </Card>
  );
}

function LoansTab({ staffId }: { staffId: string }) {
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const loans = useQuery({
    queryKey: ["hrm.loans", { staffId }],
    queryFn: () => api.hrm.loans<LoanView[]>({ staffId }),
  });
  const grant = useAction(
    (body: Row) =>
      api.hrm.staff.grantLoan<{ id: string; installments: number }>(
        staffId,
        body as never,
      ),
    { invalidate: [["hrm.loans"]], toastError: false },
  );

  return (
    <Card>
      <CardHeader className="sm:flex sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Loans &amp; advances</CardTitle>
          <CardDescription>
            Installments are deducted when a payroll run is locked.
          </CardDescription>
        </div>
        {can(me, "hrm.payroll.create") && (
          <Button onClick={() => setOpen(true)}>
            <PlusIcon /> Grant loan / advance
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <DataTable<LoanView>
          rows={loans.data?.data}
          isPending={loans.isPending}
          error={loans.error}
          empty="No loans or advances."
          columns={[
            { key: "kind", label: "Kind", type: "enum" },
            { key: "principalPaisa", label: "Principal", type: "money" },
            { key: "installmentPaisa", label: "Installment", type: "money" },
            { key: "outstandingPaisa", label: "Outstanding", type: "money" },
            {
              key: "startsMonth",
              label: "From",
              render: (l) => formatDate(l.startsMonth).slice(3),
            },
            { key: "status", label: "Status", type: "status" },
            { key: "reason", label: "Reason" },
          ]}
        />
      </CardContent>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Grant loan / advance"
        submitLabel="Grant"
        successMessage="Granted"
        fields={[
          {
            name: "kind",
            label: "Kind",
            type: "select",
            options: ["loan", "advance"],
            required: true,
          },
          {
            name: "startsMonth",
            label: "First recovery month",
            type: "month",
            required: true,
          },
          {
            name: "principalPaisa",
            label: "Principal",
            type: "money",
            required: true,
          },
          {
            name: "installmentPaisa",
            label: "Monthly installment",
            type: "money",
            required: true,
          },
          { name: "reason", label: "Reason", type: "textarea" },
        ]}
        onSubmit={(body) => grant.mutateAsync(body)}
      />
    </Card>
  );
}

function TaxTab({ staffId }: { staffId: string }) {
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<Row | null>(null);
  const years = useTaxYears();
  const save = useAction(
    (body: Row) => api.hrm.staff.setTaxProfile(staffId, body as never),
    {
      onSuccess: (r) => setSaved(r.data),
      toastError: false,
    },
  );
  const codes = (years.data ?? [])
    .map((y) => y.code)
    .sort()
    .reverse();

  return (
    <Card>
      <CardHeader className="sm:flex sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Tax profile</CardTitle>
          <CardDescription>
            Tax category (threshold), declared investment (rebate), disabled
            children (higher threshold) and first-time taxpayer (lower minimum
            tax) per income year, used for monthly TDS. Without a profile the
            staff member is taxed as &quot;general&quot; with no investment.
          </CardDescription>
        </div>
        {can(me, "hrm.payroll.create") && (
          <Button disabled={codes.length === 0} onClick={() => setOpen(true)}>
            Set tax profile
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {years.isError && <ErrorAlert error={years.error} />}
        {saved ? (
          <DetailList
            items={[
              ["Income year", String(saved.taxYearCode)],
              ["Category", humanize(saved.category)],
              [
                "Declared investment",
                formatMoney(saved.declaredInvestmentPaisa),
              ],
              ["Disabled children", String(saved.disabledChildren ?? 0)],
              ["New taxpayer", saved.newTaxpayer ? "Yes" : "No"],
            ]}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            The current profile is not shown by the API; setting it replaces the
            profile for that income year.
          </p>
        )}
      </CardContent>
      {open && (
        <FormDialog
          open={open}
          onOpenChange={setOpen}
          title="Tax profile"
          submitLabel="Save"
          successMessage="Tax profile saved"
          fields={[
            {
              name: "taxYearCode",
              label: "Income year",
              type: "select",
              options: codes,
              required: true,
              defaultValue: codes[0] ?? "",
            },
            {
              name: "category",
              label: "Category",
              type: "select",
              options: TAX_CATEGORIES,
              required: true,
              defaultValue: "general",
            },
            {
              name: "declaredInvestmentPaisa",
              label: "Declared investment (year)",
              type: "money",
            },
            {
              name: "disabledChildren",
              label: "Disabled children",
              type: "number",
              defaultValue: "0",
              help: "0–10. Each disabled child (or dependant) raises the tax-free threshold.",
            },
            {
              name: "newTaxpayer",
              label: "New taxpayer",
              type: "boolean",
              defaultValue: false,
              help: "First-time taxpayer: a lower minimum tax applies.",
            },
          ]}
          onSubmit={(body) => save.mutateAsync(body)}
        />
      )}
    </Card>
  );
}
