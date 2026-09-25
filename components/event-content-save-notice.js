export default function EventContentSaveNotice({ notice }) {
  if (!notice) return null;
  return <div className={`marketingSaveNotice ${notice.kind}`} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, padding: "10px 12px", borderRadius: 6, borderLeft: `3px solid ${notice.kind === "error" ? "#c53d45" : notice.kind === "success" ? "#319b59" : "#13829b"}`, background: notice.kind === "error" ? "#fff2f3" : notice.kind === "success" ? "#f0faf4" : "#edf7fa" }} role={notice.kind === "error" ? "alert" : "status"} aria-live="polite" aria-label="Resultaat tekst bewaren">
    {notice.kind === "pending" && <span className="marketingLoadingSpinner" aria-hidden="true" />}
    <span>{notice.message}</span>
  </div>;
}
