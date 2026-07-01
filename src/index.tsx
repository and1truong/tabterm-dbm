import type { ClientHost } from "@tabterm/module-host/client";
import { Database } from "lucide-react";
import { WorkspaceDatabaseView } from "./WorkspaceDatabaseView.tsx";

export default function activate(host: ClientHost): () => void {
  return host.ui.registerUI({
    railPage: {
      id: "dbm",
      icon: <Database size={16} />,
      label: "Database",
      // The host renders rail pages as <component tabId={...} />; close `host`
      // over it so the view can read app-state via host.context and call dbApi.
      component: ({ tabId }: { tabId: string }) => <WorkspaceDatabaseView host={host} tabId={tabId} />,
    },
  });
}
