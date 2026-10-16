import { useId, useState } from 'react';
import { Input } from './PosUI';
import { recentProductValues } from '../utils/productEditing';

export default function ProductValueInput({ label, field, products, value, onChange, disabled = false, required = false }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState(false);
  const [active, setActive] = useState(-1);
  const options = recentProductValues(products, field).filter(option => !filter || option.toLocaleLowerCase().includes(value.trim().toLocaleLowerCase()));
  const expanded = open && !disabled && options.length > 0;
  const show = () => { if (!disabled) { setOpen(true); setFilter(false); setActive(-1); } };
  const choose = option => { onChange(option); setOpen(false); setActive(-1); };
  return <div className="management-field product-value-input" onMouseEnter={show} onMouseLeave={event => { if (!event.currentTarget.contains(document.activeElement)) setOpen(false); }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setActive(-1); } }}>
    <label htmlFor={id}>{label}</label>
    <Input id={id} role="combobox" autoComplete="off" aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? `${id}-options` : undefined} aria-activedescendant={expanded && active >= 0 ? `${id}-option-${active}` : undefined} required={required} disabled={disabled} value={value} onFocus={show} onClick={show} onChange={next => { onChange(next); setFilter(true); setOpen(true); setActive(-1); }} onKeyDown={event => {
      if (event.key === 'Escape') { setOpen(false); setActive(-1); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); setOpen(true);
        setActive(index => options.length ? (index < 0 ? (event.key === 'ArrowDown' ? 0 : options.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length) : -1);
      }
      if (event.key === 'Enter' && expanded && active >= 0) { event.preventDefault(); choose(options[active]); }
    }} />
    {expanded && <ul id={`${id}-options`} role="listbox" aria-label={`최근 등록된 ${label}`} className="product-value-options">{options.map((option, index) => <li key={option} id={`${id}-option-${index}`} role="option" aria-selected={active === index}><button type="button" tabIndex={-1} onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}>{option}</button></li>)}</ul>}
  </div>;
}
