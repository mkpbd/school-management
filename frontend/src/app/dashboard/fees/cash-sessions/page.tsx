"use client";

import { LockIcon, UnlockIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { RefLabel, RefSelect } from "@/components/crud/fields";
import { DetailList, ErrorAlert, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/hooks/use-action";
import { useMe } from "@/hooks/use-me";
import { api, getActiveCampus, isApiError } from "@/lib/api";
import type { CashSessionClose } from "@/lib/api/services/fee";
import { formatDateTime, formatMoney, toPaisa } from "@/lib/format";
import { refs } from "@/lib/refs";

interface OpenSession {
  id: string;
  campusId: string | null;
  openingFloatPaisa: number;
  openedAt: string;
}

/** The API has no "my open session" read, so the id of the session opened here is remembered per user. */
const storageKey = (userId: string) => `sms.cashSession.${userId}`;

function loadSession(userId: string): OpenSession | null {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    return raw ? (JSON.parse(raw) as OpenSession) : null;
  } catch {
    return null;
  }
}

function saveSession(userId: string, s: OpenSession | null) {
  try {
    if (s) window.localStorage.setItem(storageKey(userId), JSON.stringify(s));
    else window.localStorage.removeItem(storageKey(userId));
  } catch {
    /* storage blocked: the session still works for this page view */
  }
}

export default function CashSessionsPage() {
  const { data: me } = useMe();
  if (!me) return null;
  return <CashSessions key={me.id} userId={me.id} />;
}

function CashSessions({ userId }: { userId: string }) {
  const [session, setSession] = useState<OpenSession | null>(() =>
    loadSession(userId),
  );
  const [closed, setClosed] = useState<
    (CashSessionClose & { id: string }) | null
  >(null);

  const remember = (s: OpenSession | null) => {
    setSession(s);
    saveSession(userId, s);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cash sessions"
        description="Open a session with your opening float before collecting cash; close it at the end of the day with the counted cash."
      />
      {closed && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Session closed</CardTitle>
            <CardDescription className="font-mono text-xs">
              {closed.id}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="stats stats-vertical w-full border bg-card sm:stats-horizontal">
              <div className="stat">
                <div className="stat-title">Expected cash</div>
                <div className="stat-value text-xl">
                  {formatMoney(closed.expectedCashPaisa)}
                </div>
              </div>
              <div className="stat">
                <div className="stat-title">Counted cash</div>
                <div className="stat-value text-xl">
                  {formatMoney(closed.countedCashPaisa)}
                </div>
              </div>
              <div className="stat">
                <div className="stat-title">Variance</div>
                <div
                  className={`stat-value text-xl ${closed.variancePaisa < 0 ? "text-error" : closed.variancePaisa > 0 ? "text-warning" : "text-success"}`}
                >
                  {formatMoney(closed.variancePaisa)}
                </div>
                <div className="stat-desc">
                  {closed.variancePaisa === 0
                    ? "Balanced"
                    : closed.variancePaisa < 0
                      ? "Short"
                      : "Over"}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        {session ? (
          <CloseSession
            session={session}
            onClosed={(r) => {
              setClosed({ ...r, id: session.id });
              remember(null);
            }}
            onForget={() => remember(null)}
          />
        ) : (
          <OpenSessionForm
            onOpened={(s) => {
              setClosed(null);
              remember(s);
            }}
          />
        )}
        {!session && (
          <CloseById
            onClosed={(id, r) => {
              setClosed({ ...r, id });
            }}
          />
        )}
      </div>
    </div>
  );
}

function OpenSessionForm({ onOpened }: { onOpened: (s: OpenSession) => void }) {
  const [campusId, setCampusId] = useState(() => getActiveCampus() ?? "");
  const [float, setFloat] = useState("0");
  const open = useAction(
    () =>
      api.fee.cashSessions.open({
        ...(campusId ? { campusId } : {}),
        openingFloatPaisa: toPaisa(float || "0"),
      }),
    {
      success: "Cash session opened",
      toastError: false,
      onSuccess: (r) =>
        onOpened({
          id: r.data.id,
          campusId: campusId || null,
          openingFloatPaisa: toPaisa(float || "0"),
          openedAt: new Date().toISOString(),
        }),
    },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    open.mutate(undefined);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Open my session</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          {open.error && (
            <ErrorAlert
              error={
                isApiError(open.error) &&
                open.error.code === "CASH_SESSION_OPEN"
                  ? new Error(
                      "You already have an open session (opened elsewhere). Close it by id first.",
                    )
                  : open.error
              }
            />
          )}
          <div className="space-y-1.5">
            <Label>Campus</Label>
            <RefSelect
              source={refs.campuses}
              value={campusId}
              onChange={setCampusId}
              placeholder="Active campus"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cs-float">Opening float (৳)</Label>
            <Input
              id="cs-float"
              type="number"
              step="0.01"
              min="0"
              value={float}
              onChange={(e) => setFloat(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={open.isPending}>
            {open.isPending ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <UnlockIcon />
            )}
            Open session
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function CloseSession({
  session,
  onClosed,
  onForget,
}: {
  session: OpenSession;
  onClosed: (r: CashSessionClose) => void;
  onForget: () => void;
}) {
  const [counted, setCounted] = useState("");
  const close = useAction(
    () =>
      api.fee.cashSessions.close(session.id, {
        countedCashPaisa: toPaisa(counted),
      }),
    {
      success: "Cash session closed",
      toastError: false,
      onSuccess: (r) => onClosed(r.data),
    },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    close.mutate(undefined);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>My open session</CardTitle>
        <CardDescription className="font-mono text-xs">
          {session.id}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <DetailList
          items={[
            ["Opened", formatDateTime(session.openedAt)],
            ["Opening float", formatMoney(session.openingFloatPaisa)],
            [
              "Campus",
              session.campusId ? (
                <RefLabel
                  key="c"
                  source={refs.campuses}
                  id={session.campusId}
                />
              ) : (
                "Active campus"
              ),
            ],
          ]}
        />
        <form onSubmit={submit} className="space-y-4">
          {close.error && <ErrorAlert error={close.error} />}
          <div className="space-y-1.5">
            <Label htmlFor="cs-counted">
              Counted cash (৳)<span className="text-destructive">*</span>
            </Label>
            <Input
              id="cs-counted"
              type="number"
              step="0.01"
              min="0"
              required
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={close.isPending}>
              {close.isPending ? (
                <span className="loading loading-spinner loading-xs" />
              ) : (
                <LockIcon />
              )}
              Close session
            </Button>
            {isApiError(close.error) &&
              ["CASH_SESSION_CLOSED", "NOT_FOUND"].includes(
                close.error.code,
              ) && (
                <Button type="button" variant="outline" onClick={onForget}>
                  Forget this session
                </Button>
              )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function CloseById({
  onClosed,
}: {
  onClosed: (id: string, r: CashSessionClose) => void;
}) {
  const [id, setId] = useState("");
  const [counted, setCounted] = useState("");
  const close = useAction(
    () =>
      api.fee.cashSessions.close(id.trim(), {
        countedCashPaisa: toPaisa(counted),
      }),
    {
      success: "Cash session closed",
      toastError: false,
      onSuccess: (r) => onClosed(id.trim(), r.data),
    },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    close.mutate(undefined);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Close a session by id</CardTitle>
        <CardDescription>
          For a session opened on another device, or a cashier&apos;s session
          (needs approval permission).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          {close.error && <ErrorAlert error={close.error} />}
          <Input
            placeholder="Session id (UUID)"
            className="font-mono"
            required
            pattern="[0-9a-fA-F-]{36}"
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
          <Input
            type="number"
            step="0.01"
            min="0"
            required
            placeholder="Counted cash ৳"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={close.isPending}>
            <LockIcon /> Close session
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
