type Props = {
  icon?: string
  title: string
  body: string
  actionLabel?: string
  onAction?: () => void
}

export function EmptyState({
  icon = '💪',
  title,
  body,
  actionLabel,
  onAction,
}: Props) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden>
        {icon}
      </div>
      <h2>{title}</h2>
      <p>{body}</p>
      {actionLabel && onAction ? (
        <button type="button" className="btn btn-primary" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}
