const paths = {
  star: <path d="m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3L2.9 9.6l6.3-.9L12 3Z" />,
  calendar: <><path d="M4 5h16v15H4zM8 3v4m8-4v4M4 10h16M8 14h3m-3 3h6" /></>,
  pin: <><path d="m16 3 5 5-4 1-4 4v4l-2 2-3-5-5-3 2-2h4l4-4 1-4ZM8 16l-5 5" /></>,
  dashboard: <><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" /></>,
  account: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-3a8 8 0 0 1 16 0v3" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="m3 3 18 18M10.6 5.1 12 5c6.5 0 10 7 10 7a19 19 0 0 1-3.1 4M6.2 6.2A21 21 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.8-1.8M10 10a3 3 0 0 0 4 4" /></>,
  pos: <><path d="M3 3h2l2.5 12h11L21 7H6M8 19h.01M18 19h.01" /><circle cx="8" cy="19" r="1" /><circle cx="18" cy="19" r="1" /></>,
  settings: <><path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5" /></>,
  log: <><path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3ZM9 7h6M9 11h6M9 15h3" /></>,
  projects: <><path d="M3 7V5h6l2 2h10v13H3V7ZM7 12h10m-3-3 3 3-3 3M17 16H7m3-3-3 3 3 3" /></>,
  project: <><path d="M4 5h16v15H4zM8 3v4m8-4v4M4 10h16M8 14h3m-3 3h6" /></>,
  inventory: <><path d="m12 3 9 4.5v9L12 21l-9-4.5v-9L12 3ZM3 7.5l9 4.5 9-4.5M12 12v9" /></>,
  more: <><path d="M5 12h.01M12 12h.01M19 12h.01" /></>,
  refresh: <><path d="M20 8a8 8 0 0 0-14-2L3 9m0-5v5h5M4 16a8 8 0 0 0 14 2l3-3m0 5v-5h-5" /></>,
  logout: <><path d="M10 4H4v16h6M9 12h12m-4-4 4 4-4 4" /></>,
};

const colors = { inventory: '#b45309', pos: '#2563eb', settings: '#7c3aed', log: '#059669', project: '#0f766e', projects: '#d97706', refresh: '#0891b2', logout: '#e11d48' };

export default function Icon({ name, className = '' }) {
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`ui-icon ${className}`} style={colors[name] ? { color: colors[name] } : undefined}>{paths[name]}</svg>;
}
