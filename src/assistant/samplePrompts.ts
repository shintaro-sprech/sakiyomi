import { addDays, weekday } from '../engine/dates'
import type { PlanState } from '../engine/plan'

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土']

// The machine stops on the next working day, so the example moves the plan whichever day
// the app is opened: tomorrow, or on Friday and Saturday the coming Monday.
export function samplePrompts({ today, settings }: PlanState): string[] {
  const tomorrow = addDays(today, 1)
  let stopOn = tomorrow
  for (let step = 0; step < 7 && !settings.workWeekdays.includes(weekday(stopOn)); step += 1) stopOn = addDays(stopOn, 1)
  const when = stopOn === tomorrow ? '明日' : `${WEEKDAY_NAMES[weekday(stopOn)]}曜に`
  return [
    '注番1045の材料が2日遅れると連絡がありました',
    '旋回フレームの部品の商談が取れたら、納期に間に合いますか？',
    `マシニング1が${when}1日止まります`,
    '今いちばん危ない注番はどれ？',
  ]
}

// Questions offered when the plan comes from the planner's own Excel.
export const GENERAL_PROMPTS = ['今いちばん危ない注番はどれ？', '来週いちばん混む設備はどれ？']
