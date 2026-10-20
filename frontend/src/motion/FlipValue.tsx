import { useEffect, useRef, useState } from 'react'
import { DURATION, prefersReducedMotion } from './tokens'

/**
 * 数值翻动：只在新值确实变化时播放；单位由调用方常驻在翻动容器之外。
 * 旧值上行离开，新值从下方进入；不改变真实数据，只改变呈现。
 */
export default function FlipValue({
  value,
  label,
  className = '',
}: {
  value: string
  label?: string
  className?: string
}) {
  const [display, setDisplay] = useState(value)
  const [previous, setPrevious] = useState<string>()
  const [animating, setAnimating] = useState(false)
  const displayRef = useRef(value)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (value === displayRef.current) return
    const old = displayRef.current
    displayRef.current = value
    if (prefersReducedMotion()) {
      setDisplay(value)
      setPrevious(undefined)
      setAnimating(false)
      return
    }
    setPrevious(old)
    setDisplay(value)
    setAnimating(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setPrevious(undefined)
      setAnimating(false)
    }, DURATION.flip * 1000)
  }, [value])

  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <span
      className={`flip-value ${animating ? 'is-flipping' : ''} ${className}`}
      aria-label={label ?? value}
    >
      <span className="flip-value__track">
        {previous !== undefined && (
          <span key={`old-${previous}`} className="flip-value__layer flip-value__old" aria-hidden="true">
            {previous}
          </span>
        )}
        <span key={`current-${display}`} className="flip-value__layer flip-value__current">{display}</span>
      </span>
    </span>
  )
}
