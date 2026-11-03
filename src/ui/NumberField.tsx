import { NumberInput, type NumberInputProps } from '@mantine/core'
import { useState } from 'react'

type Props = Omit<NumberInputProps, 'value' | 'onChange'> & {
  value: number
  onCommit: (value: number) => void
}

// A NumberInput for a saved number. Each number within min and max is saved
// as it is typed; an empty, unfinished or out-of-range entry is not, and
// leaving the field shows the saved number again, so the field never disagrees
// with what the plan uses. Settings are whole, non-negative numbers, and by
// default nothing beyond the range can be typed. A field whose minimum is above
// 1 passes clampBehavior="blur", so its first digit is not refused.
export function NumberField({ value, onCommit, onBlur, ...props }: Props) {
  const [draft, setDraft] = useState<number | string | null>(null)
  const inRange = (next: number) =>
    (typeof props.min !== 'number' || next >= props.min) && (typeof props.max !== 'number' || next <= props.max)
  return (
    <NumberInput
      allowDecimal={false}
      allowNegative={false}
      clampBehavior="strict"
      {...props}
      value={draft ?? value}
      onChange={(next) => {
        setDraft(next)
        if (typeof next === 'number' && inRange(next)) onCommit(next)
      }}
      onBlur={(event) => {
        setDraft(null)
        onBlur?.(event)
      }}
    />
  )
}
