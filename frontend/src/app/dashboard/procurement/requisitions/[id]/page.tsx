"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BanIcon,
  CheckIcon,
  FileTextIcon,
  PlusIcon,
  SendIcon,
  ShoppingCartIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import {
  BackLink,
  costCentresRef,
  expenseAccountsRef,
  formatQty,
  lineAmount,
  OverrunTable,
  ProcStatus,
  vendorsRef,
} from "@/components/acc/procurement";
import {
  DecideDialog,
  IssuePoDialog,
  REQUISITION_INVALIDATE,
  SelectQuotationDialog,
} from "@/components/acc/procurement-requisition";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel } from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import { invVariantsRef } from "@/components/inv/shared";
import {
  ConfirmButton,
  DetailList,
  ErrorAlert,
  Loading,
  PageHeader,
} from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type {
  RankedQuotation,
  RequisitionLine,
} from "@/lib/api/services/acc-procurement";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  todayISO,
} from "@/lib/format";
import { refs } from "@/lib/refs";

type QuotationBody = Parameters<typeof api.acc.requisitions.addQuotation>[1];

export default function RequisitionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: me } = useMe();
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(
    null,
  );
  const [quoting, setQuoting] = useState(false);
  const [selecting, setSelecting] = useState<RankedQuotation | null>(null);
  const [issuing, setIssuing] = useState(false);

  const req = useQuery({
    queryKey: ["acc.requisition", id],
    queryFn: () => api.acc.requisitions.get(id),
  });
  const r = req.data?.data;
  const canView = can(me, "acc.procurement.view");
  const ordered = r?.status === "ordered" || r?.status === "closed";
  const pos = useQuery({
    queryKey: ["acc.purchaseOrders", {}],
    queryFn: () => api.acc.purchaseOrders.list({}),
    enabled: Boolean(ordered && canView),
  });

  const submit = useAction(() => api.acc.requisitions.submit(id), {
    success: (x) => `${x.data.prNo} submitted for approval`,
    invalidate: REQUISITION_INVALIDATE,
  });
  const cancel = useAction(() => api.acc.requisitions.cancel(id), {
    success: (x) => `${x.data.prNo} cancelled`,
    invalidate: REQUISITION_INVALIDATE,
  });
  const addQuote = useAction(
    (body: QuotationBody) => api.acc.requisitions.addQuotation(id, body),
    {
      invalidate: REQUISITION_INVALIDATE,
      toastError: false,
    },
  );

  if (req.isPending) return <Loading />;
  if (req.isError || !r) return <ErrorAlert error={req.error} />;

  const isRequester = Boolean(me && r.requestedBy === me.id);
  const canApprove = can(me, "acc.procurement.approve");
  const canBuy = can(me, "acc.procurement.create");
  const lines = r.lines ?? [];
  const valid = r.quotations.filter((q) => !q.expired).length;
  const selected = r.quotations.find((q) => q.isSelected);
  const poOfReq =
    pos.data?.data.filter(
      (p) => p.requisitionId === r.id && p.status !== "cancelled",
    ) ?? [];
  const showQuotes = r.status === "approved" || r.quotations.length > 0;

  return (
    <>
      <BackLink href="/dashboard/procurement/requisitions">
        Requisitions
      </BackLink>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{r.prNo}</span> {r.title}{" "}
            <ProcStatus status={r.status} />
            {r.overBudget && (
              <span className="badge badge-error badge-outline badge-sm">
                Over budget
              </span>
            )}
          </span>
        }
        description={`Estimated ${formatMoney(r.estimatedPaisa)}`}
        actions={
          <>
            {isRequester &&
              (r.status === "draft" || r.status === "rejected") && (
                <ConfirmButton
                  variant="default"
                  title={`Submit ${r.prNo}?`}
                  description="An approver (not you) checks it against the budget."
                  confirmLabel="Submit"
                  onConfirm={() => submit.mutateAsync(undefined)}
                >
                  <SendIcon /> Submit
                </ConfirmButton>
              )}
            {r.status === "submitted" && canApprove && (
              <>
                <Button
                  size="sm"
                  disabled={isRequester}
                  onClick={() => setDecision("approved")}
                >
                  <CheckIcon /> Approve
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isRequester}
                  onClick={() => setDecision("rejected")}
                >
                  <XIcon /> Reject
                </Button>
              </>
            )}
            {r.status === "approved" && canBuy && selected && (
              <Button size="sm" onClick={() => setIssuing(true)}>
                <ShoppingCartIcon /> Issue purchase order
              </Button>
            )}
            {(isRequester || canApprove) &&
              !["ordered", "closed", "cancelled"].includes(r.status) && (
                <ConfirmButton
                  destructive
                  title={`Cancel ${r.prNo}?`}
                  description="The requisition is closed for good; raise a new one if it is needed later."
                  confirmLabel="Cancel requisition"
                  onConfirm={() => cancel.mutateAsync(undefined)}
                >
                  <BanIcon /> Cancel
                </ConfirmButton>
              )}
          </>
        }
      />
      {r.status === "submitted" && canApprove && isRequester && (
        <p className="-mt-4 mb-4 text-right text-xs text-muted-foreground">
          You raised it, so someone else must decide.
        </p>
      )}

      {poOfReq.length > 0 && (
        <div role="status" className="alert alert-info alert-soft mb-4 text-sm">
          <FileTextIcon className="size-4" />
          <span>
            Ordered on{" "}
            {poOfReq.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ", "}
                <Link
                  className="link font-mono"
                  href={`/dashboard/procurement/purchase-orders/${p.id}`}
                >
                  {p.poNo}
                </Link>
              </span>
            ))}
          </span>
        </div>
      )}

      <Card className="mb-4">
        <CardContent>
          <DetailList
            items={[
              [
                "Cost centre",
                <RefLabel
                  key="cc"
                  source={costCentresRef}
                  id={r.costCentreId}
                />,
              ],
              [
                "Department",
                <RefLabel
                  key="d"
                  source={refs.departments}
                  id={r.departmentId}
                />,
              ],
              ["Needed by", formatDate(r.neededBy)],
              ["Raised", formatDateTime(r.createdAt)],
              ["Submitted", formatDateTime(r.submittedAt)],
              ["Decided", formatDateTime(r.decidedAt)],
              ["Decision note", r.decisionNote],
              ["Overrun reason", r.overrunReason],
              [
                "Justification",
                r.justification ? (
                  <span className="whitespace-pre-line">{r.justification}</span>
                ) : (
                  "—"
                ),
              ],
            ]}
          />
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Lines</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<RequisitionLine>
            rows={lines}
            columns={[
              { key: "lineNo", label: "#" },
              { key: "description", label: "Description" },
              {
                key: "quantity",
                label: "Qty",
                className: "text-right",
                render: (l) => (
                  <span className="tabular-nums">{formatQty(l.quantity)}</span>
                ),
              },
              {
                key: "estUnitPaisa",
                label: "Est. unit",
                className: "text-right",
                type: "money",
              },
              {
                key: "amount",
                label: "Amount",
                className: "text-right",
                render: (l) => (
                  <span className="tabular-nums">
                    {formatMoney(lineAmount(l.quantity, l.estUnitPaisa ?? 0))}
                  </span>
                ),
              },
              {
                key: "accountId",
                label: "Expense account",
                ref: expenseAccountsRef,
              },
              {
                key: "itemVariantId",
                label: "Stock item",
                ref: invVariantsRef,
              },
            ]}
          />
          <p className="mt-2 text-right text-sm">
            Estimated total{" "}
            <span className="font-medium tabular-nums">
              {formatMoney(r.estimatedPaisa)}
            </span>
          </p>
        </CardContent>
      </Card>

      {r.budgetCheck && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Budget check</CardTitle>
            <CardDescription>
              Against the approved budget: what each account × cost centre has
              left after actuals and open orders.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!r.budgetCheck.budgetId && (
              <div
                role="alert"
                className="alert alert-warning alert-soft text-sm"
              >
                No approved budget for this year: all spending counts as beyond
                the budget.
              </div>
            )}
            {r.budgetCheck.overruns.length ? (
              <>
                <div
                  role="alert"
                  className="alert alert-error alert-soft text-sm"
                >
                  Beyond the budget — approval needs someone with budget
                  approval and an overrun reason.
                </div>
                <OverrunTable overruns={r.budgetCheck.overruns} />
              </>
            ) : (
              <div
                role="status"
                className="alert alert-success alert-soft text-sm"
              >
                Within the budget.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {showQuotes && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div className="space-y-1.5">
              <CardTitle>Quotations</CardTitle>
              <CardDescription>
                {valid} of {r.quotationsRequired} required valid quotation
                {r.quotationsRequired === 1 ? "" : "s"}. Ranked by price, then
                delivery; expired quotes are listed last.
              </CardDescription>
            </div>
            {r.status === "approved" && canBuy && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setQuoting(true)}
              >
                <PlusIcon /> Add quotation
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <DataTable<RankedQuotation>
              rows={r.quotations}
              empty="No quotations yet."
              columns={[
                {
                  key: "rank",
                  label: "Rank",
                  render: (q) => (q.rank === null ? "—" : `#${q.rank}`),
                },
                {
                  key: "vendorName",
                  label: "Vendor",
                  render: (q) => (
                    <Link
                      className="link link-hover font-medium"
                      href={`/dashboard/procurement/vendors/${q.vendorId}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {q.vendorName}
                    </Link>
                  ),
                },
                {
                  key: "totalPaisa",
                  label: "Total",
                  className: "text-right",
                  type: "money",
                },
                {
                  key: "aboveLowestPaisa",
                  label: "Above lowest",
                  className: "text-right",
                  render: (q) =>
                    q.aboveLowestPaisa === null ? (
                      "—"
                    ) : q.aboveLowestPaisa === 0 ? (
                      "—"
                    ) : (
                      <span className="tabular-nums">
                        +{formatMoney(q.aboveLowestPaisa)}
                      </span>
                    ),
                },
                {
                  key: "deliveryDays",
                  label: "Delivery",
                  render: (q) =>
                    q.deliveryDays === null ? "—" : `${q.deliveryDays} days`,
                },
                { key: "validUntil", label: "Valid until", type: "date" },
                { key: "quoteRef", label: "Ref", type: "mono" },
                {
                  key: "flags",
                  label: "",
                  render: (q) => (
                    <span className="flex flex-wrap gap-1">
                      {q.lowest && (
                        <span className="badge badge-success badge-soft badge-sm">
                          Lowest
                        </span>
                      )}
                      {q.expired && (
                        <span className="badge badge-error badge-soft badge-sm">
                          Expired
                        </span>
                      )}
                      {q.isSelected && (
                        <span className="badge badge-primary badge-sm">
                          Selected
                        </span>
                      )}
                    </span>
                  ),
                },
                {
                  key: "note",
                  label: "Note / reason",
                  render: (q) => (
                    <span className="text-xs">
                      {q.note}
                      {q.selectionReason && (
                        <span className="block text-muted-foreground">
                          Selected because: {q.selectionReason}
                        </span>
                      )}
                    </span>
                  ),
                },
              ]}
              actions={
                r.status === "approved" && canApprove
                  ? (q) =>
                      !q.expired && !q.isSelected ? (
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => setSelecting(q)}
                        >
                          Select
                        </Button>
                      ) : null
                  : undefined
              }
            />
          </CardContent>
        </Card>
      )}

      <DecideDialog
        requisition={r}
        decision={decision}
        onOpenChange={(o) => !o && setDecision(null)}
      />
      <SelectQuotationDialog
        requisition={r}
        quotation={selecting}
        onOpenChange={(o) => !o && setSelecting(null)}
      />
      {selected && (
        <IssuePoDialog
          requisition={r}
          open={issuing}
          onOpenChange={setIssuing}
          onIssued={(po) =>
            router.push(`/dashboard/procurement/purchase-orders/${po.id}`)
          }
        />
      )}
      <FormDialog
        open={quoting}
        onOpenChange={setQuoting}
        title={`Quotation for ${r.prNo}`}
        description={`Estimated ${formatMoney(r.estimatedPaisa)}. One quotation per vendor offer.`}
        successMessage="Quotation recorded"
        fields={[
          {
            name: "vendorId",
            label: "Vendor",
            type: "ref",
            ref: vendorsRef,
            refFilter: (v) => v.isActive !== false,
            required: true,
          },
          {
            name: "totalPaisa",
            label: "Quoted total",
            type: "money",
            required: true,
          },
          {
            name: "validUntil",
            label: "Valid until",
            type: "date",
            defaultValue: "",
            placeholder: todayISO(),
          },
          { name: "deliveryDays", label: "Delivery (days)", type: "number" },
          {
            name: "quoteRef",
            label: "Quotation ref",
            placeholder: "Vendor's quotation no",
          },
          { name: "note", label: "Note", type: "textarea" },
        ]}
        onSubmit={(body) => addQuote.mutateAsync(body as QuotationBody)}
      />
    </>
  );
}
