export default function SearchFilters({ label, fields, value, onChange, onReset }) {
  return <div className="settlement-search" role="search" aria-label={label}>
    {fields.map(field => <label key={field.key}>{field.label}{field.options
      ? <select value={value[field.key]} onChange={event => onChange({ ...value, [field.key]: event.target.value })}>{field.options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select>
      : <input type="search" placeholder={field.placeholder} value={value[field.key]} onChange={event => onChange({ ...value, [field.key]: event.target.value })} />}</label>)}
    <button type="button" className="settlement-tool" onClick={onReset}>검색 초기화</button>
  </div>;
}
