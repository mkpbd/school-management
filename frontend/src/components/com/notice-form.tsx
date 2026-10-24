"use client";

import { PaperclipIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { RefSelect } from "@/components/crud/fields";
import { retryWhileScanning, uploadFile } from "@/components/sis/shared";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { useMe } from "@/hooks/use-me";
import { api, isApiError, type Body } from "@/lib/api";
import { formatDateTime, humanize } from "@/lib/format";
import { refs } from "@/lib/refs";
import {
  AudienceEditor,
  CATEGORIES,
  fromLocalInput,
  NEEDS_ID,
  openNoticeAttachment,
  PRIORITIES,
  toLocalInput,
  type Audience,
  type NoticeCategory,
  type NoticePriority,
  type NoticeRow,
} from "./shared";

const ACCEPT = "application/pdf,image/jpeg,image/png";
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 10;

type NoticeBody = Body<"/api/v1/com/notices/{id}", "put">;
type Attachment = { fileId: string; name: string };

/** Compose / edit a notice: bilingual text, audiences, attachments (purpose notice_attachment), schedule or publish. */
export function NoticeFormDialog({
  open,
  onOpenChange,
  notice,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing draft / scheduled notice: edit mode. */
  notice?: NoticeRow;
  onSaved: (n: NoticeRow) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        {open && (
          <NoticeForm
            notice={notice}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function NoticeForm({
  notice,
  onClose,
  onSaved,
}: {
  notice?: NoticeRow;
  onClose: () => void;
  onSaved: (n: NoticeRow) => void;
}) {
  const { data: me } = useMe();
  const orgWide = me?.campusIds === "*";
  const [campusId, setCampusId] = useState(notice?.campusId ?? "");
  const [allCampuses, setAllCampuses] = useState(
    notice ? notice.campusId === null : false,
  );
  const [titleEn, setTitleEn] = useState(notice?.titleEn ?? "");
  const [titleBn, setTitleBn] = useState(notice?.titleBn ?? "");
  const [bodyEn, setBodyEn] = useState(notice?.bodyEn ?? "");
  const [bodyBn, setBodyBn] = useState(notice?.bodyBn ?? "");
  const [category, setCategory] = useState<NoticeCategory>(
    (notice?.category as NoticeCategory) ?? "general",
  );
  const [isCircular, setIsCircular] = useState(notice?.isCircular ?? false);
  const [priority, setPriority] = useState<NoticePriority>(
    notice?.priority ?? "normal",
  );
  const [schedule, setSchedule] = useState(
    notice ? new Date(notice.publishAt) > new Date() : false,
  );
  const [publishAt, setPublishAt] = useState(toLocalInput(notice?.publishAt));
  const [expiresAt, setExpiresAt] = useState(toLocalInput(notice?.expiresAt));
  const [publishToWebsite, setPublishToWebsite] = useState(
    notice?.publishToWebsite ?? false,
  );
  const [sendSms, setSendSms] = useState(notice?.sendSms ?? false);
  const [audiences, setAudiences] = useState<Audience[]>(
    notice?.audiences?.length
      ? notice.audiences
      : [{ type: "everyone", id: null }],
  );
  const [attachments, setAttachments] = useState<Attachment[]>(
    (notice?.attachmentFileIds ?? []).map((fileId, i) => ({
      fileId,
      name: `Attachment ${i + 1}`,
    })),
  );
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<"" | "draft" | "publish">("");
  const [error, setError] = useState<string | null>(null);

  async function addFiles(list: FileList | null) {
    const files = [...(list ?? [])];
    if (!files.length) return;
    if (attachments.length + files.length > MAX_FILES) {
      setError(`At most ${MAX_FILES} attachments.`);
      return;
    }
    const tooBig = files.find((f) => f.size > MAX_BYTES);
    if (tooBig) {
      setError(`${tooBig.name} is larger than 10 MB.`);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      for (const f of files) {
        const fileId = await uploadFile(f, "notice_attachment");
        setAttachments((prev) => [...prev, { fileId, name: f.name }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function buildBody(): NoticeBody {
    return {
      ...(allCampuses ? { campusId: null } : campusId ? { campusId } : {}),
      titleEn: titleEn.trim(),
      ...(titleBn.trim() ? { titleBn: titleBn.trim() } : {}),
      bodyEn: bodyEn.trim(),
      ...(bodyBn.trim() ? { bodyBn: bodyBn.trim() } : {}),
      category,
      isCircular,
      priority,
      ...(schedule && publishAt
        ? { publishAt: fromLocalInput(publishAt) }
        : {}),
      ...(expiresAt ? { expiresAt: fromLocalInput(expiresAt) } : {}),
      publishToWebsite,
      sendSms,
      attachmentFileIds: attachments.map((a) => a.fileId),
      audiences: audiences.map((a) => ({
        type: a.type,
        id: NEEDS_ID.has(a.type) ? a.id : null,
      })),
    };
  }

  async function submit(
    e: { preventDefault: () => void },
    mode: "draft" | "publish",
  ) {
    e.preventDefault();
    if (audiences.some((a) => NEEDS_ID.has(a.type) && !a.id)) {
      setError("Choose who each audience entry points at.");
      return;
    }
    if (schedule && !publishAt) {
      setError("Choose when to publish.");
      return;
    }
    setError(null);
    setBusy(mode);
    try {
      const body = buildBody();
      // freshly uploaded files are usable once their virus scan is clean
      let saved = await retryWhileScanning(async () =>
        notice
          ? (await api.com.notices.update<NoticeRow>(notice.id, body)).data
          : (
              await api.com.notices.create<NoticeRow>({
                ...body,
                publishNow: mode === "publish",
              })
            ).data,
      );
      if (notice && mode === "publish")
        saved = (await api.com.notices.publish<NoticeRow>(notice.id)).data;
      toast.success(
        saved.status === "published"
          ? `Published to ${saved.recipientCount ?? 0} recipient${saved.recipientCount === 1 ? "" : "s"}`
          : saved.status === "scheduled"
            ? `Scheduled for ${formatDateTime(saved.publishAt)}`
            : "Draft saved",
      );
      onSaved(saved);
      onClose();
    } catch (err) {
      if (isApiError(err) && Object.keys(err.fieldErrors).length) {
        setError(
          Object.entries(err.fieldErrors)
            .map(([path, msg]) => `${path.replace(/^body\./, "")}: ${msg}`)
            .join("; "),
        );
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    } finally {
      setBusy("");
    }
  }

  const disabled = busy !== "" || uploading;

  return (
    <form onSubmit={(e) => submit(e, "publish")} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{notice ? "Edit notice" : "New notice"}</DialogTitle>
        <DialogDescription>
          Push goes to every recipient; urgent and emergency notices also go by
          SMS and e-mail.
        </DialogDescription>
      </DialogHeader>
      {error && (
        <div role="alert" className="alert alert-error alert-soft text-sm">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="n-campus">Campus</Label>
          <RefSelect
            id="n-campus"
            source={refs.campuses}
            value={allCampuses ? "" : campusId}
            placeholder={allCampuses ? "All campuses" : "Active campus"}
            onChange={setCampusId}
          />
          {orgWide && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch
                size="sm"
                checked={allCampuses}
                onCheckedChange={(c) => setAllCampuses(Boolean(c))}
              />
              All campuses (organisation-wide)
            </label>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="n-category">Category</Label>
            <select
              id="n-category"
              className="select select-sm h-8 w-full"
              value={isCircular ? "circular" : category}
              disabled={isCircular}
              onChange={(e) => setCategory(e.target.value as NoticeCategory)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {humanize(c)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="n-priority">Priority</Label>
            <select
              id="n-priority"
              className="select select-sm h-8 w-full"
              value={priority}
              onChange={(e) => setPriority(e.target.value as NoticePriority)}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {humanize(p)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="n-title-en">
            Title (English)<span className="text-destructive">*</span>
          </Label>
          <Input
            id="n-title-en"
            required
            minLength={3}
            maxLength={200}
            value={titleEn}
            onChange={(e) => setTitleEn(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="n-title-bn">Title (Bangla)</Label>
          <Input
            id="n-title-bn"
            lang="bn"
            maxLength={200}
            value={titleBn}
            onChange={(e) => setTitleBn(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="n-body-en">
            Body (English)<span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="n-body-en"
            rows={6}
            required
            minLength={3}
            maxLength={20_000}
            value={bodyEn}
            onChange={(e) => setBodyEn(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="n-body-bn">Body (Bangla)</Label>
          <Textarea
            id="n-body-bn"
            lang="bn"
            rows={6}
            maxLength={20_000}
            value={bodyBn}
            onChange={(e) => setBodyBn(e.target.value)}
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label>
            Audience<span className="text-destructive">*</span>
          </Label>
          <AudienceEditor value={audiences} onChange={setAudiences} />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="n-files">Attachments</Label>
          {attachments.length > 0 && (
            <ul className="space-y-1">
              {attachments.map((a) => (
                <li key={a.fileId} className="flex items-center gap-2 text-sm">
                  <PaperclipIcon className="size-3.5 text-muted-foreground" />
                  {notice?.attachmentFileIds.includes(a.fileId) ? (
                    <button
                      type="button"
                      className="link"
                      onClick={() => openNoticeAttachment(notice.id, a.fileId)}
                    >
                      {a.name}
                    </button>
                  ) : (
                    <span>{a.name}</span>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${a.name}`}
                    onClick={() =>
                      setAttachments((prev) =>
                        prev.filter((x) => x.fileId !== a.fileId),
                      )
                    }
                  >
                    <XIcon />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <input
            id="n-files"
            type="file"
            multiple
            accept={ACCEPT}
            disabled={disabled || attachments.length >= MAX_FILES}
            className="file-input file-input-sm w-full"
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <p className="text-xs text-muted-foreground">
            {uploading
              ? "Uploading…"
              : `PDF, JPEG or PNG up to 10 MB each, at most ${MAX_FILES}. Files are virus-scanned before use.`}
          </p>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={schedule}
              onCheckedChange={(c) => setSchedule(Boolean(c))}
            />
            Schedule for later
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            {schedule && (
              <div className="space-y-1.5">
                <Label htmlFor="n-publish-at">
                  Publish at<span className="text-destructive">*</span>
                </Label>
                <Input
                  id="n-publish-at"
                  type="datetime-local"
                  required
                  value={publishAt}
                  onChange={(e) => setPublishAt(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="n-expires-at">Expires at</Label>
              <Input
                id="n-expires-at"
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={isCircular}
              onCheckedChange={(c) => setIsCircular(Boolean(c))}
            />
            Circular (numbered)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={sendSms}
              onCheckedChange={(c) => setSendSms(Boolean(c))}
            />
            Also send SMS
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={publishToWebsite}
              onCheckedChange={(c) => setPublishToWebsite(Boolean(c))}
            />
            Show on the public website
          </label>
        </div>
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={busy !== ""}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          onClick={(e) => {
            const form = e.currentTarget.form;
            if (form && !form.reportValidity()) return;
            void submit(e, "draft");
          }}
        >
          {busy === "draft" && (
            <span className="loading loading-spinner loading-xs" />
          )}
          Save draft
        </Button>
        <Button type="submit" disabled={disabled}>
          {busy === "publish" && (
            <span className="loading loading-spinner loading-xs" />
          )}
          {schedule ? "Schedule" : "Publish now"}
        </Button>
      </DialogFooter>
    </form>
  );
}
