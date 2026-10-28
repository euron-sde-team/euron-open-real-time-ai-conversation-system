import { InterviewView } from "@/components/interview/interview-view";

export default async function InterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InterviewView id={id} />;
}
