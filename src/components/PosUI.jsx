import { useState } from 'react';
import { won } from '../utils/productDisplay';

export function Quantity({ label, value }) {
  return <div className="management-field"><span>{label}</span><output className="management-quantity mono">{won(value)}개</output></div>;
}

export function ProductImage({ imageUrl, name }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const [defaultFailed, setDefaultFailed] = useState(false);
  const isDefault = !imageUrl || imageUrl === failedUrl;
  const source = isDefault ? '/images/default-product.svg' : imageUrl;
  return <div className="product-image relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-[#f1f5f9]">
    {isDefault && defaultFailed ? <span className="text-xs text-[#64748b]">No Image</span> : <img key={source} src={source} alt={isDefault ? 'No Image' : name || '상품 이미지'} loading="lazy" className="h-full w-full object-contain" onError={() => isDefault ? setDefaultFailed(true) : setFailedUrl(imageUrl)} />}
    {isDefault && !defaultFailed && <span className="absolute bottom-[25%] text-xs text-slate-500" aria-hidden="true">No Image</span>}
  </div>;
}

export function ItemButton({ name, imageUrl, price, stock, soldout, bundle, creatorName, onClick }) {
  return <button disabled={soldout} onClick={onClick} className={`product-card flex min-w-0 flex-col overflow-hidden rounded-xl border text-left transition hover:border-register hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed ${bundle ? 'border-blue-200 bg-blue-50' : 'border-line bg-white'} ${soldout ? 'is-soldout' : ''}`}>
    {!bundle && <ProductImage imageUrl={imageUrl} name={name} />}
    <div className="flex flex-1 flex-col p-3">
      {bundle && <span className="mb-2 text-[10px] font-bold tracking-wide text-register">세트 할인</span>}
      <span className="product-name break-words">{name}</span>
      {creatorName && <span className="product-creator mt-1 self-start max-w-full break-words">{creatorName}</span>}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-1 pt-3"><span className="product-price mono text-register">{won(price)}원</span><span className={`product-stock ${soldout ? 'text-danger' : 'text-slate-500'}`}>{soldout ? '품절' : stock}</span></div>
    </div>
  </button>;
}
export function Panel({ title, children, actions }) { return <section className="rounded-2xl border border-line bg-white p-3.5"><div className="mb-2.5 flex items-center justify-between gap-3"><h2 className="text-[15px] font-bold">{title}</h2>{actions}</div>{children}</section>; }
export function Input({ value, onChange, className = '', ...props }) { return <input {...props} value={value} onChange={(e) => onChange(e.target.value)} className={`w-full rounded border border-line p-1.5 text-[13px] ${className}`} />; }
export function Stat({ label, value }) { return <div className="rounded-2xl border border-line bg-white p-3.5"><div className="text-[11px] uppercase tracking-wide text-[#64748b]">{label}</div><div className="mono mt-1 text-2xl font-bold">{value}</div></div>; }
