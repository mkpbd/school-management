"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  BanIcon,
  PencilIcon,
  RefreshCwIcon,
  SendIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { NoticeFormDialog } from "@/components/com/notice-form";
import {
  AudienceLabel,
  NoticeAttachments,
  PriorityBadge,
  type NoticeRow,
  type ReadReceipts,
} from "@/components/com/shared";
import { DataTable } from "@/components/crud/data-table";
import { RefLabel } from "@/components/crud/fields";
import {
  DetailList,
  ErrorAlert,
  Loading,
  PageHeader,
  StatusBadge,
} from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import { formatDateTime, humanize } from "@/lib/format";
import { refs } from "@/lib/refs";

export default function NoticeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const [editing, setEditing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [lang, setLang] = useState<"en" | "bn">("en");
  const notice = useQuery({
    queryKey: ["com.notices", "detail", id],
    queryFn: () => api.com.notices.get<NoticeRow>(id),
  });
  const publish = useAction(() => api.com.notices.publish<NoticeRow>(id), {
    success: (r) =>
      r.data.status === "scheduled"
        ? `Scheduled for ${formatDateTime(r.data.publishAt)}`
        : `Published to ${r.data.recipientCount ?? 0} recipients`,
    invalidate: [["com.notices"]],
  });

  if (notice.isPending) return <Loading />;
  if (notice.isError) return <ErrorAlert error={notice.error} />;
  const n = notice.data.data;
  const canCreate = can(me, "com.notice.create");
  const editable = n.status === "draft" || n.status === "scheduled";

  return (
    <>
      <Button
        nativeButton={false}
        variant="link"
        size="sm"
        className="mb-2 px-0"
        render={<Link href="/dashboard/communication/notices" />}
      >
        <ArrowLeftIcon /> Notices
      </Button>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {n.titleEn}
            <StatusBadge status={n.status} />
            <PriorityBadge priority={n.priority} />
          </span>
        }
        description={
          n.status === "published"
            ? `Published ${formatDateTime(n.publishedAt)} to ${n.recipientCount ?? 0} recipients`
            : n.status === "scheduled"
              ? `Scheduled for ${formatDateTime(n.publishAt)}`
              : humanize(n.status)
        }
        actions={
          canCreate && (
            <>
              {editable && (
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <PencilIcon /> Edit
                </Button>
              )}
              {editable && (
                <Button
                  disabled={publish.isPending}
                  onClick={() => publish.mutate(undefined)}
                >
                  <SendIcon />{" "}
                  {new Date(n.publishAt) > new Date()
                    ? "Schedule"
                    : "Publish now"}
                </Button>
              )}
              {n.status !== "withdrawn" && (
                <Button
                  variant="destructive"
                  onClick={() => setWithdrawing(true)}
                >
                  <BanIcon /> Withdraw
                </Button>
              )}
            </>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>
              {lang === "bn" && n.titleBn ? n.titleBn : n.titleEn}
            </CardTitle>
            {(n.titleBn || n.bodyBn) && (
              <div role="tablist" className="tabs tabs-box tabs-xs">
                <button
                  type="button"
                  role="tab"
                  className={`tab ${lang === "en" ? "tab-active" : ""}`}
                  onClick={() => setLang("en")}
                >
                  English
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`tab ${lang === "bn" ? "tab-active" : ""}`}
                  onClick={() => setLang("bn")}
                >
                  বাংলা
                </button>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm whitespace-pre-wrap" lang={lang}>
              {lang === "bn" && n.bodyBn ? n.bodyBn : n.bodyEn}
            </p>
            <NoticeAttachments noticeId={n.id} fileIds={n.attachmentFileIds} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <DetailList
              items={[
                [
                  "Campus",
                  n.campusId ? (
                    <RefLabel source={refs.campuses} id={n.campusId} />
                  ) : (
                    "All campuses"
                  ),
                ],
                ["Category", humanize(n.category)],
                ["Circular no", n.circularNo],
                ["Publish at", formatDateTime(n.publishAt)],
                ["Expires at", formatDateTime(n.expiresAt)],
                ["Recipients", n.recipientCount],
                ["Website", n.publishToWebsite ? "Yes" : "No"],
                ["SMS", n.sendSms || n.priority !== "normal" ? "Yes" : "No"],
              ]}
            />
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Audience</div>
              <div className="flex flex-wrap gap-1">
                {(n.audiences ?? []).map((a) => (
                  <AudienceLabel key={`${a.type}:${a.id ?? ""}`} audience={a} />
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {(n.status === "published" || n.recipientCount !== null) && (
        <Receipts noticeId={n.id} />
      )}

      <NoticeFormDialog
        open={editing}
        onOpenChange={setEditing}
        notice={n}
        onSaved={() => void notice.refetch()}
      />
      <WithdrawDialog
        noticeId={n.id}
        open={withdrawing}
        onOpenChange={setWithdrawing}
      />
    </>
  );
}

function Receipts({ noticeId }: { noticeId: string }) {
  const receipts = useQuery({
    queryKey: ["com.notices", "receipts", noticeId],
    queryFn: () => api.com.notices.receipts<ReadReceipts>(noticeId),
  });
  const r = receipts.data?.data;
  const byType = Object.entries(r?.byType ?? {}).map(([type, v]) => ({
    id: type,
    type,
    ...v,
  }));

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Read receipts</CardTitle>
          <CardDescription>
            Who has opened the notice, by guardians, students and staff.
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh"
          disabled={receipts.isFetching}
          onClick={() => receipts.refetch()}
        >
          <RefreshCwIcon />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {receipts.isError ? (
          <ErrorAlert error={receipts.error} />
        ) : !r ? (
          <Loading />
        ) : (
          <>
            <div className="stats stats-vertical w-full border bg-card sm:stats-horizontal">
              <div className="stat">
                <div className="stat-title">Recipients</div>
                <div className="stat-value text-2xl tabular-nums">
                  {r.recipients}
                </div>
              </div>
              <div className="stat">
                <div className="stat-title">Read</div>
                <div className="stat-value text-2xl tabular-nums">{r.read}</div>
              </div>
              <div className="stat">
                <div className="stat-title">Read rate</div>
                <div className="stat-value text-2xl tabular-nums">
                  {r.readPercent}%
                </div>
                <progress
                  className="progress progress-primary w-full"
                  value={r.readPercent}
                  max={100}
                />
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-medium">By audience type</h3>
                <DataTable
                  rows={byType}
                  empty="No recipients."
                  columns={[
                    { key: "type", label: "Type", type: "enum" },
                    {
                      key: "recipients",
                      label: "Recipients",
                      className: "text-right tabular-nums",
                    },
                    {
                      key: "read",
                      label: "Read",
                      className: "text-right tabular-nums",
                    },
                    {
                      key: "pct",
                      label: "%",
                      className: "text-right tabular-nums",
                      render: (t) =>
                        t.recipients
                          ? `${Math.round((t.read / t.recipients) * 1000) / 10}%`
                          : "—",
                    },
                  ]}
                />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium">
                  Unread ({r.recipients - r.read})
                  {r.unread.length < r.recipients - r.read &&
                    `, first ${r.unread.length} shown`}
                </h3>
                <div className="max-h-96 overflow-y-auto">
                  <DataTable
                    rows={r.unread}
                    rowKey={(u) => u.userId}
                    empty="Everyone has read it."
                    columns={[
                      { key: "userType", label: "Type", type: "enum" },
                      { key: "contact", label: "Contact", type: "mono" },
                      {
                        key: "userId",
                        label: "User",
                        render: (u) => (
                          <span className="font-mono text-xs">
                            {u.userId.slice(0, 8)}…
                          </span>
                        ),
                      },
                    ]}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function WithdrawDialog({
  noticeId,
  open,
  onOpenChange,
}: {
  noticeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const withdraw = useAction(
    () =>
      api.com.notices.withdraw(
        noticeId,
        reason.trim() ? { reason: reason.trim() } : {},
      ),
    {
      success: "Notice withdrawn",
      invalidate: [["com.notices"]],
      onSuccess: () => {
        setReason("");
        onOpenChange(false);
      },
    },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Withdraw notice</DialogTitle>
          <DialogDescription>
            It disappears from every notice board and the website. This cannot
            be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="w-reason">Reason</Label>
          <Textarea
            id="w-reason"
            rows={3}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={withdraw.isPending}
            onClick={() => withdraw.mutate(undefined)}
          >
            {withdraw.isPending && (
              <span className="loading loading-spinner loading-xs" />
            )}
            Withdraw
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
