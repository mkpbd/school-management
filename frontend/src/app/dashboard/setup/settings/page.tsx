"use client";

import { useQuery } from "@tanstack/react-query";
import { PencilIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { DataTable } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api, type Row } from "@/lib/api";
import { refs } from "@/lib/refs";

interface SettingRow extends Row {
  id: string;
  key: string;
  value: unknown;
}

export default function SettingsPage() {
  const { data: me } = useMe();
  const [campusId, setCampusId] = useState("");
  const [editing, setEditing] = useState<SettingRow | "new" | null>(null);

  const settings = useQuery({
    queryKey: ["core.settings", campusId],
    queryFn: () => api.core.settings.list(campusId ? { campusId } : {}),
  });
  const rows: SettingRow[] = Object.entries(settings.data?.data ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ id: key, key, value }));

  const save = useAction(
    ({ key, value }: { key: string; value: unknown }) =>
      api.core.settings.set(key, { value, campusId: campusId || null }),
    { invalidate: [["core.settings"]], toastError: false },
  );
  const canEdit = can(me, "core.settings.edit");

  return (
    <>
      <PageHeader
        title="Settings"
        description="Organisation defaults. Pick a campus to see and set its overrides."
        actions={
          canEdit && (
            <Button onClick={() => setEditing("new")}>
              <PlusIcon /> New setting
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="sm:w-64">
            <RefSelect
              source={refs.campuses}
              value={campusId}
              placeholder="Organisation defaults"
              onChange={setCampusId}
            />
          </div>
          <DataTable
            rows={rows}
            isPending={settings.isPending}
            error={settings.error}
            columns={[
              { key: "key", label: "Key", type: "mono" },
              {
                key: "value",
                label: "Value",
                render: (r) => (
                  <code className="text-xs break-all">
                    {JSON.stringify(r.value)}
                  </code>
                ),
              },
            ]}
            actions={
              canEdit
                ? (row) => (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Edit"
                      onClick={() => setEditing(row)}
                    >
                      <PencilIcon />
                    </Button>
                  )
                : undefined
            }
          />
        </CardContent>
      </Card>
      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === "new" ? "New setting" : `Edit ${editing?.key ?? ""}`}
        description={
          campusId
            ? "Saved as an override for the selected campus."
            : "Saved as the organisation default."
        }
        fields={[
          ...(editing === "new"
            ? [
                {
                  name: "key",
                  label: "Key",
                  required: true,
                  placeholder: "fee.late_fine_paisa",
                  wide: true,
                },
              ]
            : []),
          {
            name: "value",
            label: "Value (JSON)",
            type: "json",
            required: true,
            help: 'e.g. 500, true, "text" or {"a":1}',
          },
        ]}
        submitLabel="Save"
        onSubmit={async (_body, values) => {
          const key =
            editing === "new" ? String(values.key).trim() : editing!.key;
          await save.mutateAsync({
            key,
            value: JSON.parse(String(values.value)),
          });
        }}
        row={
          editing && editing !== "new"
            ? { value: JSON.stringify(editing.value, null, 2) }
            : undefined
        }
      />
    </>
  );
}
