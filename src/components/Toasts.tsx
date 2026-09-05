import { useCallback, useRef, useState } from 'react'
import { AlertIcon, CheckIcon } from './Icons'

export interface Toast {
  id: number
  message: string
  tone: 'success' | 'error' | 'info'
}

export type Notify = (message: string, tone?: Toast['tone']) => void

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const notify = useCallback<Notify>(
    (message, tone = 'info') => {
      const id = nextId.current++
      setToasts((current) => [...current.slice(-3), { id, message, tone }])
      // Errors deserve longer than a confirmation nobody needs to read.
      window.setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 2600)
    },
    [dismiss],
  )

  return { toasts, notify, dismiss }
}

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  if (toasts.length === 0) return null
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast glass ${toast.tone}`} onClick={() => dismiss(toast.id)}>
          <span className="icon">
            {toast.tone === 'error' ? <AlertIcon size={16} /> : <CheckIcon size={16} />}
          </span>
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  )
}
