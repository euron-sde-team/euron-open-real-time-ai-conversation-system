import type { Metadata } from "next";
import { RoomView } from "@/components/room/room-view";

export const metadata: Metadata = { title: "Interview room" };

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RoomView id={id} />;
}
