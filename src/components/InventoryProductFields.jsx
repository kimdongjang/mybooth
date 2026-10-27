import { Input } from './PosUI';
import ProductValueInput from './ProductValueInput';

export default function InventoryProductFields({ draft, products, onChange, disabled, registrationDate, showPricing = false,hideCreator=false }) {
  return <fieldset disabled={disabled}><legend>공통 상품 정보</legend><div className="management-fields">
    <label className="management-field product-name-field"><span>상품 이름</span><Input required maxLength={200} value={draft.name} onChange={value => onChange('name', value)} /></label>
    {[['vtuberName', '캐릭터'], ['goodsType', '굿즈 종류'], ['creatorName', '제작자'], ['genre', '작품/시리즈']].filter(([key])=>!hideCreator||key!=='creatorName').map(([key, label]) => <ProductValueInput key={key} field={key} label={label} products={products} value={draft[key]} onChange={value => onChange(key, value)} required={key === 'goodsType'} disabled={disabled} />)}
    {showPricing && [['price','판매가'],['cost','원가']].map(([key,label])=><label key={key} className="management-field"><span>{label}</span><Input type="number" min="0" max="2147483647" step="1" value={draft[key] ?? 0} onChange={value=>onChange(key,value === '' ? '' : Number(value))}/></label>)}
    {registrationDate !== undefined && <label className="management-field"><span>상품 등록일</span><Input aria-label="상품 등록일" type="date" required={Boolean(draft.createdAt) || Object.hasOwn(draft, 'registrationDate')} min="0001-01-01" max="9999-12-31" value={registrationDate} onChange={value => onChange('registrationDate', value)} /></label>}
  </div></fieldset>;
}
