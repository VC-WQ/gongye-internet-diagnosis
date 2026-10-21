import FlipText from './FlipText'
/** Numeric presentation shares the hinge, never a counter that invents values. */
export default function FlipValue({ value, label, className = '' }: { value: string; label?: string; className?: string }) {
  return <FlipText value={value} label={label} className={`flip-value ${className}`} />
}
