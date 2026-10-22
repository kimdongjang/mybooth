export default function LoadingState() {
  return <div className="inventory-loading" aria-busy="true"><div className="inventory-skeleton" aria-hidden="true"><div className="inventory-skeleton-search"/><div className="inventory-skeleton-toolbar"/><div className="inventory-skeleton-table">{Array.from({length:6},(_,i)=><div className="inventory-skeleton-row" key={i}>{[0,1,2,3].map(j=><span key={j}/>)}</div>)}</div></div><div className="inventory-loading-status" role="status"><span className="inventory-loading-spinner" aria-hidden="true"/><span className="sr-only">불러오는 중</span></div></div>;
}
