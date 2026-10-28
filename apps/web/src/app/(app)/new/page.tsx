import type { Metadata } from "next";
import { Suspense } from "react";
import { NewInterview } from "@/components/interview/new-interview";

export const metadata: Metadata = { title: "New interview" };

export default function NewInterviewPage() {
  return (
    <Suspense>
      <NewInterview />
    </Suspense>
  );
}
