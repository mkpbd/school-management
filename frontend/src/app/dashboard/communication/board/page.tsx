"use client";

import { useQuery } from "@tanstack/react-query";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PaperclipIcon,
} from "lucide-react";
import { useState } from "react";
import {
  NoticeAttachments,
  PriorityBadge,
  type NoticeRow,
} from "@/components/com/shared";
import { Empty, ErrorAlert, Loading, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAction } from "@/hooks/use-action";
import { api } from "@/lib/api";
import { formatDateTime, humanize } from "@/lib/format";

const LIMIT = 30;

/** The signed-in user's notice board (any logged-in user): notices addressed to them, urgent first. */
export default function NoticeBoardPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [opened, setOpened] = useState<NoticeRow | null>(null);

  const query = {
    limit: LIMIT,
    offset,
    ...(unreadOnly ? { unreadOnly: "true" as const } : {}),
  };
  const feed = useQuery({
    queryKey: ["com.board", query],
    queryFn: () => api.com.notices.mine<NoticeRow[]>(query),
  });
  const markRead = useAction((id: string) => api.com.notices.markRead(id), {
    invalidate: [["com.board"]],
  });

  const rows = feed.data?.data ?? [];

  function open(n: NoticeRow) {
    setOpened(n);
    if (!n.readAt) markRead.mutate(n.id);
  }

  return (
    <>
      <PageHeader
        title="Notice board"
        description="Notices and circulars addressed to you. Urgent ones come first."
      />
      <Card>
        <CardContent className="space-y-4">
          <div role="tablist" className="tabs tabs-box tabs-sm w-fit">
            <button
              type="button"
              role="tab"
              className={`tab ${!unreadOnly ? "tab-active" : ""}`}
              onClick={() => {
                setUnreadOnly(false);
                setOffset(0);
              }}
            >
              All
            </button>
            <button
              type="button"
              role="tab"
              className={`tab ${unreadOnly ? "tab-active" : ""}`}
              onClick={() => {
                setUnreadOnly(true);
                setOffset(0);
              }}
            >
              Unread
            </button>
          </div>
          {feed.isError ? (
            <ErrorAlert error={feed.error} />
          ) : feed.isPending ? (
            <Loading />
          ) : !rows.length ? (
            <Empty>
              {unreadOnly
                ? "You have read every notice."
                : "No notices for you yet."}
            </Empty>
          ) : (
            <ul className="divide-y rounded-lg border">
              {rows.map((n) => (
                <li key={n.id} className="flex items-start gap-3 p-3">
                  <span
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-primary"}`}
                    aria-label={n.readAt ? undefined : "Unread"}
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => open(n)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={n.readAt ? "" : "font-semibold"}>
                        {n.titleEn}
                      </span>
                      {n.priority !== "normal" && (
                        <PriorityBadge priority={n.priority} />
                      )}
                      <span className="badge badge-ghost badge-sm">
                        {humanize(n.category)}
                      </span>
                      {n.circularNo && (
                        <span className="font-mono text-xs text-muted-foreground">
                          {n.circularNo}
                        </span>
                      )}
                      {n.attachmentFileIds.length > 0 && (
                        <PaperclipIcon className="size-3.5 text-muted-foreground" />
                      )}
                    </div>
                    {n.titleBn && (
                      <div className="text-sm text-muted-foreground" lang="bn">
                        {n.titleBn}
                      </div>
                    )}
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {n.bodyEn}
                    </p>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatDateTime(n.publishedAt ?? n.publishAt)}
                    </div>
                  </button>
                  {!n.readAt && (
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={markRead.isPending}
                      onClick={() => markRead.mutate(n.id)}
                    >
                      <CheckIcon /> Mark read
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {(offset > 0 || rows.length >= LIMIT) && (
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Previous"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              >
                <ChevronLeftIcon />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Next"
                disabled={rows.length < LIMIT}
                onClick={() => setOffset(offset + LIMIT)}
              >
                <ChevronRightIcon />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      <NoticeReader notice={opened} onClose={() => setOpened(null)} />
    </>
  );
}

function NoticeReader({
  notice,
  onClose,
}: {
  notice: NoticeRow | null;
  onClose: () => void;
}) {
  const [lang, setLang] = useState<"en" | "bn">("en");
  const n = notice;
  const bn = lang === "bn";
  return (
    <Dialog open={n !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        {n && (
          <>
            <DialogHeader>
              <DialogTitle lang={lang}>
                {bn && n.titleBn ? n.titleBn : n.titleEn}
              </DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-2">
                {formatDateTime(n.publishedAt ?? n.publishAt)}
                <span className="badge badge-ghost badge-sm">
                  {humanize(n.category)}
                </span>
                {n.priority !== "normal" && (
                  <PriorityBadge priority={n.priority} />
                )}
                {n.circularNo && (
                  <span className="font-mono text-xs">{n.circularNo}</span>
                )}
              </DialogDescription>
            </DialogHeader>
            {(n.titleBn || n.bodyBn) && (
              <div role="tablist" className="tabs tabs-box tabs-xs w-fit">
                <button
                  type="button"
                  role="tab"
                  className={`tab ${!bn ? "tab-active" : ""}`}
                  onClick={() => setLang("en")}
                >
                  English
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`tab ${bn ? "tab-active" : ""}`}
                  onClick={() => setLang("bn")}
                >
                  বাংলা
                </button>
              </div>
            )}
            <p className="text-sm whitespace-pre-wrap" lang={lang}>
              {bn && n.bodyBn ? n.bodyBn : n.bodyEn}
            </p>
            <NoticeAttachments noticeId={n.id} fileIds={n.attachmentFileIds} />
            {n.expiresAt && (
              <p className="text-xs text-muted-foreground">
                Until {formatDateTime(n.expiresAt)}
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
