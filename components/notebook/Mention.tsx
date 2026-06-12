interface MentionProps {
  user: string
}

/** An inline reference to a teammate. */
export function Mention({ user }: MentionProps) {
  return (
    <span className="inline-flex items-center rounded-md bg-secondary px-1.5 py-0.5 text-[13px] font-medium text-secondary-foreground">
      @{user}
    </span>
  )
}
