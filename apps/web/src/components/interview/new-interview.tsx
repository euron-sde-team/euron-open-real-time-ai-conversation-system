"use client";

/**
 * Start an interview from a resume (PDF or DOCX, read on the server and never kept) or
 * from a job description. Either way the server plans in the background and we move to
 * the interview page, which shows the plan as soon as it is ready.
 */
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp, X } from "lucide-react";
import { Button, Input, Label, Switch, Textarea, toast } from "@open-conversation/ui";
import { PageBar } from "@/components/app/app-shell";
import { UnderlineTabs } from "@/components/common/underline-tabs";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { usePreferences } from "@/lib/interviews/queries";
import { useAppMeta } from "@/lib/meta";
import { qk } from "@/lib/query-keys";

type From = "resume" | "jd";

export function NewInterview() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: meta } = useAppMeta();
  const prefs = usePreferences();
  const [from, setFrom] = useState<From>(params.get("from") === "jd" ? "jd" : "resume");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [jd, setJd] = useState("");
  const [proctoring, setProctoring] = useState<boolean | null>(null);
  const proctor = proctoring ?? prefs.data?.proctoringDefault ?? false;
  const maxMb = meta?.limits.maxResumeMb ?? 8;
  const maxJd = meta?.limits.maxJobDescriptionChars ?? 12000;
  const proctoringOn = meta?.features.proctoring !== false;

  const create = useMutation({
    mutationFn: () =>
      from === "resume"
        ? api().interviews.fromResume({ file: file!, fileName: file!.name, proctoring: proctoringOn && proctor })
        : api().interviews.fromJobDescription({ company: company.trim(), role: role.trim(), jobDescription: jd.trim(), proctoring: proctoringOn && proctor }),
    onSuccess: (iv) => {
      qc.setQueryData(qk.interview(iv.id), iv);
      void qc.invalidateQueries({ queryKey: qk.interviewsAll });
      void qc.invalidateQueries({ queryKey: qk.usage });
      router.push(`/i/${iv.id}`);
    },
    meta: { silent: true },
    onError: (e) => toast.error({ title: "Could not start", description: errorMessage(e) }),
  });

  const pick = (f: File | null | undefined) => {
    if (!f) return;
    if (f.size > maxMb * 1024 * 1024) return toast.error({ title: "That file is too large", description: `Resumes can be up to ${maxMb} MB.` });
    if (!/\.(pdf|docx)$/i.test(f.name)) return toast.error({ title: "Unsupported file", description: "Upload a PDF or a Word (.docx) file." });
    setFile(f);
  };

  const ready = from === "resume" ? !!file : company.trim().length > 0 && role.trim().length > 1 && jd.trim().length >= 80;
  const tabs = [
    ...(meta?.features.resumeUpload !== false ? [{ value: "resume" as const, label: "From a resume" }] : []),
    ...(meta?.features.jobDescription !== false ? [{ value: "jd" as const, label: "From a job description" }] : []),
  ];

  return (
    <div>
      <PageBar title="New interview" />
      <form
        className="mx-auto max-w-[680px] px-4 pb-16 pt-4 sm:px-6 sm:pt-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) create.mutate();
        }}
      >
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">New interview</h1>
        <p className="mt-1.5 text-[15px] text-muted-foreground">The questions are written for you in about half a minute. You can review and edit them before you start.</p>
        <UnderlineTabs className="mt-6" label="Start from" tabs={tabs} value={from} onChange={setFrom} />

        {from === "resume" ? (
          <div className="mt-6">
            <label
              onDragOver={(e) => (e.preventDefault(), setDragging(true))}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                pick(e.dataTransfer.files?.[0]);
              }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border border-dashed px-6 py-12 text-center transition-colors ${dragging ? "border-primary bg-primary-soft/50" : "border-input hover:bg-muted/50"}`}
            >
              <FileUp className="size-6 text-primary" aria-hidden />
              <span className="text-[15px] font-medium">{file ? file.name : "Drop your resume here, or choose a file"}</span>
              <span className="text-[13px] text-subtle-foreground">{file ? `${(file.size / 1024).toFixed(0)} KB` : `PDF or Word (.docx), up to ${maxMb} MB`}</span>
              <input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" data-testid="resume-input" onChange={(e) => pick(e.target.files?.[0])} />
            </label>
            {file ? (
              <button type="button" onClick={() => setFile(null)} className="mt-2 inline-flex items-center gap-1 text-[13px] text-subtle-foreground hover:text-foreground">
                <X className="size-3.5" /> Remove
              </button>
            ) : null}
            <p className="mt-3 text-[13px] text-subtle-foreground">Your resume is read once to write the questions and a short summary for the interviewer. The file itself is never stored.</p>
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="company">Company</Label>
                <Input id="company" value={company} onChange={(e) => setCompany(e.target.value)} maxLength={120} placeholder="Example Labs" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role">Role</Label>
                <Input id="role" value={role} onChange={(e) => setRole(e.target.value)} maxLength={120} placeholder="Senior Backend Engineer" required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="jd">Job description</Label>
              <Textarea id="jd" value={jd} onChange={(e) => setJd(e.target.value)} rows={12} maxLength={maxJd} placeholder="Paste the responsibilities, required skills and qualifications." required />
              <p className="text-[12.5px] text-subtle-foreground">
                {jd.trim().length < 80 ? `At least 80 characters (${jd.trim().length} so far).` : `${jd.length.toLocaleString()} of ${maxJd.toLocaleString()} characters.`}
              </p>
            </div>
          </div>
        )}

        {proctoringOn ? (
          <div className="mt-8 flex items-start gap-3 border-t border-border pt-5">
            <Switch id="proctoring" checked={proctor} onCheckedChange={setProctoring} />
            <label htmlFor="proctoring" className="min-w-0">
              <span className="block text-[14.5px] font-medium">Practise with proctoring</span>
              <span className="block text-[13px] text-subtle-foreground">Your camera checks that you stay in view and the tab notes when you leave it, like a proctored interview. Video stays on your device; only the events are saved.</span>
            </label>
          </div>
        ) : null}

        <div className="mt-8 flex items-center gap-3">
          <Button type="submit" size="lg" loading={create.isPending} disabled={!ready}>
            Prepare my interview
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
