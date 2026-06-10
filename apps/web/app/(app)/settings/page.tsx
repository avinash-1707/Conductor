import { Settings } from "lucide-react";
import { EmptyState } from "@/components/app/view-state";

export default function SettingsPage() {
  return (
    <EmptyState
      icon={Settings}
      message="Members, your model key, and organization profile will be managed here."
    />
  );
}
