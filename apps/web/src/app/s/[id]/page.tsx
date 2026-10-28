import type { Metadata } from "next";
import { SharedView } from "@/components/report/shared-view";

export const metadata: Metadata = { title: "Shared report", robots: { index: false, follow: false } };

export default async function SharedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SharedView id={id} />;
}
