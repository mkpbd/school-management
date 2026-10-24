"use client";

import { useQuery } from "@tanstack/react-query";
import { LockIcon, SaveIcon, SmartphoneIcon } from "lucide-react";
import { useState } from "react";
import {
  PREF_CHANNELS,
  type Preferences,
  type PrefChannel,
  type PushDevice,
} from "@/components/com/shared";
import { DataTable } from "@/components/crud/data-table";
import { ErrorAlert, Loading, PageHeader } from "@/components/page";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAction } from "@/hooks/use-action";
import { api } from "@/lib/api";
import { humanize } from "@/lib/format";

const CHANNEL_LABEL: Record<PrefChannel, string> = {
  sms: "SMS",
  email: "E-mail",
  push: "Push",
  whatsapp: "WhatsApp",
};

/** Notification preferences (per event and channel, quiet hours) and push devices (any logged-in user). */
export default function PreferencesPage() {
  const prefs = useQuery({
    queryKey: ["com.preferences"],
    queryFn: () => api.com.me.preferences<Preferences>(),
  });

  return (
    <>
      <PageHeader
        title="Notification preferences"
        description="Choose how you hear from the school."
      />
      {prefs.isError ? (
        <ErrorAlert error={prefs.error} />
      ) : prefs.isPending ? (
        <Loading />
      ) : (
        // remount after a save so the form starts from the saved state
        <PreferencesForm key={prefs.dataUpdatedAt} prefs={prefs.data.data} />
      )}
      <Devices />
    </>
  );
}

function PreferencesForm({ prefs }: { prefs: Preferences }) {
  const [changes, setChanges] = useState<Record<string, boolean>>({});
  const [customQuiet, setCustomQuiet] = useState(prefs.quietHours !== null);
  const [from, setFrom] = useState(
    prefs.quietHours?.from ?? prefs.schoolQuietHours?.from ?? "22:00",
  );
  const [to, setTo] = useState(
    prefs.quietHours?.to ?? prefs.schoolQuietHours?.to ?? "07:00",
  );

  const initialQuiet = JSON.stringify(prefs.quietHours);
  const quiet = customQuiet ? { from, to } : null;
  const quietChanged = JSON.stringify(quiet) !== initialQuiet;
  const settings = Object.entries(changes).map(([key, enabled]) => {
    const [eventCode, channel] = key.split("|") as [string, PrefChannel];
    return { eventCode, channel, enabled };
  });

  const save = useAction(
    () =>
      api.com.me.updatePreferences({
        ...(quietChanged ? { quietHours: quiet } : {}),
        ...(settings.length ? { settings } : {}),
      }),
    { success: "Preferences saved", invalidate: [["com.preferences"]] },
  );

  const isOn = (eventCode: string, channel: string, enabled: boolean) =>
    changes[`${eventCode}|${channel}`] ?? enabled;
  function toggle(
    eventCode: string,
    channel: string,
    original: boolean,
    value: boolean,
  ) {
    const key = `${eventCode}|${channel}`;
    setChanges((prev) => {
      const next = { ...prev };
      if (value === original) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Quiet hours</CardTitle>
          <CardDescription>
            Non-urgent SMS and push wait until quiet hours end.{" "}
            {prefs.schoolQuietHours
              ? `School default: ${prefs.schoolQuietHours.from}–${prefs.schoolQuietHours.to}.`
              : "The school has no default."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex items-center gap-2 text-sm sm:mb-1.5">
            <Switch
              checked={customQuiet}
              onCheckedChange={(c) => setCustomQuiet(Boolean(c))}
            />
            Use my own quiet hours
          </label>
          {customQuiet && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="q-from">From</Label>
                <Input
                  id="q-from"
                  type="time"
                  className="w-32"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="q-to">To</Label>
                <Input
                  id="q-to"
                  type="time"
                  className="w-32"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>
            Switch channels off per notification. Security and safety messages
            (marked <LockIcon className="inline size-3" />) cannot be switched
            off.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Notification</TableHead>
                {PREF_CHANNELS.map((c) => (
                  <TableHead key={c} className="text-center">
                    {CHANNEL_LABEL[c]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {prefs.events.map((ev) => (
                <TableRow key={ev.eventCode}>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {ev.label}
                      {ev.mandatory && (
                        <LockIcon
                          className="size-3 text-muted-foreground"
                          aria-label="Always on"
                        />
                      )}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {ev.eventCode}
                    </div>
                  </TableCell>
                  {PREF_CHANNELS.map((c) => {
                    const ch = ev.channels.find((x) => x.channel === c);
                    return (
                      <TableCell key={c} className="text-center">
                        {ch ? (
                          <Switch
                            aria-label={`${ev.label} by ${CHANNEL_LABEL[c]}`}
                            checked={
                              ev.mandatory || isOn(ev.eventCode, c, ch.enabled)
                            }
                            disabled={ev.mandatory}
                            onCheckedChange={(v) =>
                              toggle(ev.eventCode, c, ch.enabled, Boolean(v))
                            }
                          />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          disabled={
            save.isPending ||
            (!quietChanged && !settings.length) ||
            (customQuiet && (!from || !to))
          }
          onClick={() => save.mutate(undefined)}
        >
          {save.isPending ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            <SaveIcon />
          )}
          Save preferences
        </Button>
      </div>
    </div>
  );
}

function Devices() {
  const devices = useQuery({
    queryKey: ["com.devices"],
    queryFn: () => api.com.me.devices<PushDevice[]>(),
  });
  const [revoking, setRevoking] = useState<PushDevice | null>(null);

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SmartphoneIcon className="size-4" /> Push devices
        </CardTitle>
        <CardDescription>
          Phones and browsers that receive push notifications for your account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable<PushDevice>
          rows={devices.data?.data}
          isPending={devices.isPending}
          error={devices.error}
          empty="No devices registered."
          columns={[
            { key: "app", label: "App", type: "enum" },
            {
              key: "platform",
              label: "Platform",
              render: (d) =>
                d.platform === "ios" ? "iOS" : humanize(d.platform),
            },
            {
              key: "tokenTail",
              label: "Device",
              render: (d) => (
                <span className="font-mono text-xs">…{d.tokenTail}</span>
              ),
            },
            { key: "lastSeenAt", label: "Last seen", type: "datetime" },
          ]}
          actions={(d) => (
            <Button variant="outline" size="xs" onClick={() => setRevoking(d)}>
              Revoke
            </Button>
          )}
        />
      </CardContent>
      <RevokeDialog device={revoking} onClose={() => setRevoking(null)} />
    </Card>
  );
}

/** Stops push to the chosen device (sign-out of notifications on that phone or browser). */
function RevokeDialog({
  device,
  onClose,
}: {
  device: PushDevice | null;
  onClose: () => void;
}) {
  const revoke = useAction(() => api.com.me.removeDevice(device!.id), {
    success: "Device revoked",
    invalidate: [["com.devices"]],
    onSuccess: onClose,
  });
  return (
    <Dialog open={device !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Revoke device</DialogTitle>
          <DialogDescription>
            Push notifications stop on this{" "}
            {device?.platform === "ios" ? "iOS" : device?.platform} device (…
            <span className="font-mono">{device?.tokenTail}</span>). It is
            registered again the next time you sign in there.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={revoke.isPending}
            onClick={() => revoke.mutate(undefined)}
          >
            Revoke
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
