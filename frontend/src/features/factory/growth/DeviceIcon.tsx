import type { IconKey } from './visualConfig'

export function DeviceIconPaths({ icon }: { icon: IconKey }) {
  return <>{icon === 'compressor' ? <><path d="M4 7h12v12H4zM7 10h6M7 13h6M7 16h6M8 7V4h5v3M16 10h4v7h-4M6 19v2M14 19v2" /></>
      : icon === 'pump' ? <><circle cx="13" cy="13" r="6" /><circle cx="13" cy="13" r="2" /><path d="M7 10H3V6h6M13 7V3h5v5M5 21h15M8 18v3M17 18v3" /></>
      : icon === 'motor' ? <><path d="M5 7h12v11H5zM2 10h3M17 10h5v4h-5M8 7V4h6v3M7 18v3M15 18v3M8 10v5M11 10v5M14 10v5" /></>
      : <><path d="M4 9h16v11H4zM7 9V4h10v5M7 13h4v4H7zM14 13h3M14 16h3" /></>}
  </>
}

export default function DeviceIcon({ icon, color }: { icon: IconKey; color?: string }) {
  return <svg className="device-visual-icon" viewBox="0 0 24 24" fill="none" stroke={color ?? 'currentColor'} strokeWidth="1.5" aria-hidden><DeviceIconPaths icon={icon} /></svg>
}
