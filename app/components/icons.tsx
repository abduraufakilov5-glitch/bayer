import type { CSSProperties } from 'react'
const paths = {
  plus: 'M12 5v14M5 12h14',
  bag: 'M5 7h14l1 14H4L5 7ZM9 7V5a3 3 0 0 1 6 0v2',
  search: 'm21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  arrow: 'm9 5 7 7-7 7',
  back: 'm14 5-7 7 7 7',
  share: 'M12 16V3m-4 4 4-4 4 4M7 11H4v10h16V11h-3',
  copy: 'M9 9h12v12H9zM15 5V2H2v13h3',
  check: 'm5 12 4 4L19 6',
  clock: 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  logout: 'M9 3H3v18h6M9 12h12m-4-4 4 4-4 4',
  photo: 'M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5M8 7h.01',
  tune: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  link: 'm10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
  sun: 'M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z',
  trash: 'M3 6h18M8 6V3h8v3M19 6l-1 15H6L5 6M10 11v5M14 11v5',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z',
  restore: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  wallet: 'M3 6h16a2 2 0 0 1 2 2v11H5a2 2 0 0 1-2-2V6Zm0 0 13-3v3M16 12h5',
} as const
export function Icon({name, size = 20, style, className}: {name: keyof typeof paths; size?: number; style?: CSSProperties; className?: string}) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" style={style} className={className}><path d={paths[name]} /></svg>
}
