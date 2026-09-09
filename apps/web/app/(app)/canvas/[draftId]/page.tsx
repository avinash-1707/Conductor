"use client";

import { useParams } from "next/navigation";
import { CollaborativeEditor } from "@/components/canvas/collaborative-editor";

export default function CanvasDraftPage() {
  const params = useParams<{ draftId: string }>();
  return <CollaborativeEditor draftId={params.draftId} />;
}
