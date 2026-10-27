export default function LoadingState() {
  return <div className="inventory-loading loading-state" role="status" aria-busy="true"><span className="inventory-loading-spinner" aria-hidden="true"/><span>불러오는 중…</span></div>;
}
