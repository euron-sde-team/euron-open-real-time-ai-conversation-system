"use client";

/** The owner's report: header, actions (share, PDF), and the report body. Updates while answers are still being scored. */
import { useState } from "react";
import { Download, Share2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button, toast } from "@open-conversation/ui";
import { PageBar } from "@/components/app/app-shell";
import { ErrorState } from "@/components/common/states";
import { api } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { errorMessage } from "@/lib/errors";
import { useAppMeta } from "@/lib/meta";
import { qk } from "@/lib/query-keys";
import { ReportBody } from "./report-body";
import { ShareDialog } from "./share-dialog";

export function ReportView({ id }: { id: string }) {
  const { data: meta } = useAppMeta();
  const { data: report, error, refetch } = useQuery({
    queryKey: qk.report(id),
    queryFn: () => api().interviews.report(id),
    refetchInterval: (q) => (q.state.data?.questions.some((x) => x.answer?.status === "SCORING") ? 2000 : false),
  });
  const [sharing, setSharing] = useState(false);
  const [downloading, setDownloading] = useState(false);

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} className="mt-24" />;
  if (!report)
    return (
      <div>
        <PageBar />
        <div className="mx-auto max-w-[860px] px-4 pt-8 sm:px-6">
          <div className="h-9 w-2/3 animate-pulse rounded bg-muted" />
          <div className="mt-10 flex gap-12">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 w-24 animate-pulse rounded bg-muted" />
            ))}
          </div>
        </div>
      </div>
    );

  const pdf = async () => {
    setDownloading(true);
    try {
      saveBlob(await api().interviews.reportPdf(id), `${report.interview.title.replace(/[^A-Za-z0-9 _-]/g, "").trim().replace(/\s+/g, "-") || "interview"}-report.pdf`);
    } catch (e) {
      toast.error({ title: "Could not download", description: errorMessage(e) });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <PageBar
        title="Report"
        actions={
          <div className="flex gap-2">
            {meta?.features.pdfExport !== false ? (
              <Button variant="ghost" size="sm" onClick={pdf} loading={downloading}>
                <Download /> PDF
              </Button>
            ) : null}
            {meta?.features.sharing !== false ? (
              <Button variant="outline" size="sm" onClick={() => setSharing(true)} data-testid="share-report">
                <Share2 /> Share
              </Button>
            ) : null}
          </div>
        }
      />
      <article className="mx-auto max-w-[860px] px-4 pb-20 pt-4 sm:px-6 sm:pt-8">
        <p className="text-[13px] font-medium uppercase tracking-[0.06em] text-primary">Interview report</p>
        <h1 className="mt-1 font-display text-[30px] font-semibold leading-tight tracking-[-0.02em]">{report.interview.title}</h1>
        <p className="mt-2 text-[14px] text-subtle-foreground">
          {[report.candidateName, report.interview.company, report.interview.domain, new Date(report.interview.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })].filter(Boolean).join(" · ")}
        </p>
        <ReportBody report={report} />
      </article>
      {sharing ? <ShareDialog interviewId={id} title={report.interview.title} open onOpenChange={setSharing} /> : null}
    </div>
  );
}
