import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

interface ConfidenceBadgeProps {
  confidence: number
  className?: string
}

export function ConfidenceBadge({
  confidence,
  className,
}: ConfidenceBadgeProps) {
  let colorClass: string
  if (confidence >= 0.85) {
    colorClass =
      'bg-primary/20 text-primary hover:bg-primary/30 border-primary/20'
  } else if (confidence >= 0.6) {
    colorClass =
      'bg-secondary text-secondary-foreground hover:bg-secondary/80 border-secondary'
  } else {
    colorClass =
      'bg-destructive/20 text-destructive hover:bg-destructive/30 border-destructive/20'
  }

  const percentage = Math.round(confidence * 100)

  return (
    <Badge variant='outline' className={cn(colorClass, className)}>
      {percentage}%
    </Badge>
  )
}
