"use client";

/** Create a read-only link to a report: choose whether the transcript is included and when the link expires, then copy it. */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import type { ShareSummary } from "@open-conversation/types";
import { Button, Checkbox, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, NativeSelect, toast } from "@open-conversation/ui";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";

export function ShareDialog({ interviewId, title, open, onOpenChange }: { interviewId: string; title: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [transcript, setTranscript] = useState(false);
  const [days, setDays] = useState("30");
  const [link, setLink] = useState<ShareSummary | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useMutation({
    mutationFn: () => api().interviews.share(interviewId, { includeTranscript: transcript, expiresInDays: days === "never" ? null : Number(days) }),
    onSuccess: (s) => {
      setLink(s);
      void qc.invalidateQueries({ queryKey: qk.shares });
    },
    meta: { silent: true },
    onError: (e) => toast.error({ title: "Could not create the link", description: errorMessage(e) }),
  });
  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link.url).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share this report</DialogTitle>
          <DialogDescription>Anyone with the link can read the scores and feedback for “{title}”. You can revoke it in Settings.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {link ? (
            <div className="flex gap-2">
              <Input readOnly value={link.url} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
              <Button variant="outline" onClick={copy} aria-label="Copy link">
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
          ) : (
            <>
              <label className="flex items-start gap-3 text-[14px]">
                <Checkbox checked={transcript} onCheckedChange={(v) => setTranscript(v === true)} className="mt-0.5" />
                <span>
                  <span className="block font-medium">Include the transcript and code</span>
                  <span className="block text-[13px] text-subtle-foreground">Off by default: only scores and feedback are shown.</span>
                </span>
              </label>
              <div className="flex items-center gap-3">
                <Label htmlFor="share-expiry" className="w-24">
                  Expires
                </Label>
                <NativeSelect id="share-expiry" value={days} onChange={(e) => setDays(e.target.value)} className="w-44">
                  <option value="7">In 7 days</option>
                  <option value="30">In 30 days</option>
                  <option value="90">In 90 days</option>
                  <option value="never">Never</option>
                </NativeSelect>
              </div>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {link ? "Done" : "Cancel"}
          </Button>
          {!link ? (
            <Button onClick={() => create.mutate()} loading={create.isPending}>
              Create link
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
