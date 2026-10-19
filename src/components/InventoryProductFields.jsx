import { Input } from './PosUI';
import ProductValueInput from './ProductValueInput';

export default function InventoryProductFields({ draft, products, onChange, disabled }) {
  return <fieldset disabled={disabled}><legend>공통 상품 정보</legend><div className="management-fields">
    <label className="management-field product-name-field"><span>상품 이름</span><Input required maxLength={200} value={draft.name} onChange={value => onChange('name', value)} /></label>
    {[['vtuberName', '캐릭터'], ['goodsType', '굿즈 종류'], ['creatorName', '제작자'], ['genre', '장르']].map(([key, label]) => <ProductValueInput key={key} field={key} label={label} products={products} value={draft[key]} onChange={value => onChange(key, value)} required={key === 'goodsType'} disabled={disabled} />)}
  </div></fieldset>;
}
