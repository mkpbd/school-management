"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  BookmarkPlusIcon,
  ImageIcon,
  PlusIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/crud/data-table";
import { RefSelect } from "@/components/crud/fields";
import { FormDialog } from "@/components/crud/form-dialog";
import {
  CopyStatusButton,
  ReserveDialog,
  uploadFile,
} from "@/components/lib/shared";
import {
  ConfirmButton,
  DetailList,
  ErrorAlert,
  Loading,
  PageHeader,
} from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { can, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { CopyRow } from "@/lib/api/services/lib";
import { formatValue, humanize } from "@/lib/format";
import { refs } from "@/lib/refs";

export default function TitleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const [campusId, setCampusId] = useState("");
  const [adding, setAdding] = useState(false);
  const [idemKey, setIdemKey] = useState("");
  const [reserving, setReserving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const title = useQuery({
    queryKey: ["lib.title", id, campusId],
    queryFn: () => api.lib.titles.get(id, campusId ? { campusId } : {}),
  });
  const addCopies = useAction(
    (body: Parameters<typeof api.lib.titles.addCopies>[1]) =>
      api.lib.titles.addCopies(id, body, { idempotencyKey: idemKey }),
    {
      invalidate: [["lib.title"], ["lib.copies"], ["lib.catalogue"]],
      toastError: false,
    },
  );
  const setCover = useAction(
    (fileId: string | null) => api.lib.titles.setCover(id, { fileId }),
    {
      success: (r) => (r.data.coverFileId ? "Cover updated" : "Cover removed"),
      invalidate: [["lib.titles"]],
    },
  );

  if (title.isPending) return <Loading />;
  if (title.isError) return <ErrorAlert error={title.error} />;
  const t = title.data.data;

  async function onCoverFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const fileId = await uploadFile(file, "library_cover");
      setCover.mutate(fileId); // errors are toasted by useAction
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <>
      <Button
        nativeButton={false}
        variant="link"
        size="sm"
        className="mb-2 px-0"
        render={<Link href="/dashboard/library/titles" />}
      >
        <ArrowLeftIcon /> Titles
      </Button>
      <PageHeader
        title={t.title}
        description={t.subtitle ?? undefined}
        actions={
          <>
            {t.available === 0 && (
              <Button variant="outline" onClick={() => setReserving(true)}>
                <BookmarkPlusIcon /> Reserve
              </Button>
            )}
            {can(me, "lib.catalogue.edit") && (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void onCoverFile(e.target.files?.[0])}
                />
                <Button
                  variant="outline"
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                >
                  {uploading ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : (
                    <ImageIcon />
                  )}{" "}
                  Upload cover
                </Button>
                <ConfirmButton
                  variant="ghost"
                  size="default"
                  title="Remove the cover image?"
                  confirmLabel="Remove"
                  onConfirm={() => setCover.mutateAsync(null)}
                >
                  Remove cover
                </ConfirmButton>
              </>
            )}
            {can(me, "lib.catalogue.create") && (
              <Button
                onClick={() => {
                  setIdemKey(crypto.randomUUID());
                  setAdding(true);
                }}
              >
                <PlusIcon /> Add copies
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardContent className="space-y-4">
            <DetailList
              items={[
                ["Authors", formatValue(t.authors)],
                ["ISBN", t.isbn ?? "—"],
                ["Publisher", t.publisher ?? "—"],
                ["Media type", humanize(t.mediaType)],
                ["Category", t.categoryCode ?? "—"],
              ]}
            />
            <div className="stats stats-vertical w-full border bg-card sm:stats-horizontal">
              <div className="stat">
                <div className="stat-title">Copies</div>
                <div className="stat-value text-2xl">{t.copies}</div>
              </div>
              <div className="stat">
                <div className="stat-title">Available</div>
                <div
                  className={`stat-value text-2xl ${t.available ? "text-success" : "text-error"}`}
                >
                  {t.available}
                </div>
              </div>
              <div className="stat">
                <div className="stat-title">Waiting</div>
                <div className="stat-value text-2xl">{t.waiting}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="sm:flex sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Copies</CardTitle>
            <div className="sm:w-56">
              <RefSelect
                source={refs.campuses}
                value={campusId}
                placeholder="All campuses"
                onChange={setCampusId}
              />
            </div>
          </CardHeader>
          <CardContent>
            <DataTable<CopyRow>
              rows={t.copiesList}
              empty="No copies accessioned yet."
              columns={[
                { key: "accessionNo", label: "Accession", type: "mono" },
                { key: "barcode", label: "Barcode", type: "mono" },
                { key: "campusId", label: "Campus", ref: refs.campuses },
                { key: "shelfLocation", label: "Shelf" },
                { key: "pricePaisa", label: "Price", type: "money" },
                { key: "status", label: "Status", type: "status" },
              ]}
              actions={
                can(me, "lib.catalogue.edit")
                  ? (c) => (
                      <CopyStatusButton
                        copy={c}
                        invalidate={[
                          "lib.title",
                          "lib.copies",
                          "lib.catalogue",
                        ]}
                      />
                    )
                  : undefined
              }
            />
          </CardContent>
        </Card>
      </div>

      <FormDialog
        open={adding}
        onOpenChange={setAdding}
        title="Add copies"
        description="Give a count (barcode = accession number) or scan pre-printed barcode labels."
        submitLabel="Accession"
        fields={[
          {
            name: "campusId",
            label: "Campus",
            type: "ref",
            ref: refs.campuses,
            help: "Default: active campus",
          },
          {
            name: "count",
            label: "Number of copies",
            type: "number",
            help: "1–100",
          },
          {
            name: "barcodes",
            label: "Barcodes",
            type: "list",
            wide: true,
            help: "Comma separated; instead of a count",
          },
          { name: "shelfLocation", label: "Shelf location" },
          { name: "acquiredOn", label: "Acquired on", type: "date" },
          { name: "pricePaisa", label: "Price per copy", type: "money" },
        ]}
        successMessage="Copies accessioned"
        onSubmit={(body) =>
          addCopies.mutateAsync(
            body as Parameters<typeof api.lib.titles.addCopies>[1],
          )
        }
      />
      <ReserveDialog
        open={reserving}
        onOpenChange={setReserving}
        titleId={id}
      />
    </>
  );
}
