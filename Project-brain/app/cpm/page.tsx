import { redirect } from "next/navigation";

// The standalone "/cpm" advanced view (backed by the separate scheduling
// module) has been consolidated into the primary CPM Studio at /furnace/cpm,
// which is the sidebar route and uses the audited cpm_schedules engine. This
// route now redirects so existing links (dashboard quick-link, sidebar alias)
// keep working.
export default function CpmPage() {
  redirect("/furnace/cpm");
}
