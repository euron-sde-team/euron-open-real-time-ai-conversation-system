"use client";

/** The public report behind a share link: no account needed, no app chrome beyond the wordmark. */
import { useQuery } from "@tanstack/react-query";
import { NotFoundState } from "@/components/common/states";
import { Wordmark } from "@/components/common/wordmark";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { ReportBody } from "./report-body";

export function SharedView({ id }: { id: string }) {
  const { data: report, error, isLoading } = useQuery({ queryKey: qk.shared(id), queryFn: () => api().shares.open(id), retry: false });
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-[860px] items-center px-4 sm:px-6">
        <Wordmark />
      </header>
      {error ? (
        <NotFoundState className="mt-16" title="This link does not work" description="It may have been revoked by its owner, or it has expired." />
      ) : isLoading || !report ? (
        <div className="mx-auto max-w-[860px] px-4 pt-8 sm:px-6">
          <div className="h-9 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      ) : (
        <article className="mx-auto max-w-[860px] px-4 pb-20 pt-4 sm:px-6">
          <p className="text-[13px] font-medium uppercase tracking-[0.06em] text-primary">Shared interview report</p>
          <h1 className="mt-1 font-display text-[30px] font-semibold leading-tight tracking-[-0.02em]">{report.interview.title}</h1>
          <p className="mt-2 text-[14px] text-subtle-foreground">
            {[report.candidateName, report.interview.company, report.interview.domain, `Shared ${new Date(report.sharedAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}`].filter(Boolean).join(" · ")}
          </p>
          <ReportBody report={report} />
        </article>
      )}
    </div>
  );
}
