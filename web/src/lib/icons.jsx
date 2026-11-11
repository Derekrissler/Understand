// Small stroke icons (24x24 grid), sized by CSS.
const I = ({ d, size = 16, children, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    {d ? <path d={d} /> : children}
  </svg>
)
export const IconOverview = (p) => <I {...p}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></I>
export const IconFlow = (p) => <I {...p}><circle cx="5" cy="12" r="2.5" /><circle cx="19" cy="6" r="2.5" /><circle cx="19" cy="18" r="2.5" /><path d="M7.5 12h4l5-6M11.5 12l5 6" /></I>
export const IconModules = (p) => <I {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><path d="M10 6.5h3.5a2 2 0 0 1 2 2V14" /></I>
export const IconCode = (p) => <I {...p} d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16" />
export const IconTest = (p) => <I {...p}><path d="M9 3h6M10 3v6.5L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9.5V3" /><path d="M7 15h10" /></I>
export const IconTap = (p) => <I {...p}><path d="M2 12h4l3-8 4 16 3-8h6" /></I>
export const IconIssues = (p) => <I {...p}><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4M12 17.2v.1" /></I>
export const IconRefresh = (p) => <I {...p} d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
export const IconPlay = (p) => <I {...p} d="M7 4.5v15l12-7.5-12-7.5Z" />
export const IconX = (p) => <I {...p} d="M6 6l12 12M18 6 6 18" />
export const IconFolder = (p) => <I {...p} d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-12Z" />
export const IconArrow = (p) => <I {...p} d="M5 12h14M13 6l6 6-6 6" />
export const IconPipe = (p) => <I {...p} d="M4 7h9a4 4 0 0 1 4 4v6M13 13l4 4 4-4" />
export const IconSearch = (p) => <I {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></I>
export const IconExternal = (p) => <I {...p} d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
export const IconTrace = (p) => <I {...p}><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.5 6H14a4 4 0 0 1 0 8h-4a4 4 0 0 0 0 8h5.5" /></I>
export const IconDownload = (p) => <I {...p} d="M12 4v11M7 10l5 5 5-5M5 20h14" />
export const IconCopy = (p) => <I {...p}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></I>
export const Logo = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32">
    <path d="M8 16 16 9 24 16" stroke="#8b93a7" strokeWidth="1.8" fill="none" />
    <circle cx="8" cy="16" r="3.4" fill="#60a5fa" />
    <circle cx="16" cy="9" r="3.4" fill="#a78bfa" />
    <circle cx="24" cy="16" r="3.4" fill="#34d399" />
    <path d="M8 22h16" stroke="#3a4255" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
)
