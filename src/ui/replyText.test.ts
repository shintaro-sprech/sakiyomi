import { describe, expect, it } from 'vitest'

import { boldRuns, richBlocks } from './replyText'

describe('richBlocks', () => {
  it('starts a list right under a line of text', () => {
    const text = '**ほかに問題が2つあります。**\n- 欠品：11/8から\n- 代理店：今日にも注文\n\nこれらも試算しますか。'

    expect(richBlocks(text)).toEqual([
      { kind: 'paragraph', lines: ['**ほかに問題が2つあります。**'] },
      { kind: 'bullets', items: ['欠品：11/8から', '代理店：今日にも注文'] },
      { kind: 'paragraph', lines: ['これらも試算しますか。'] },
    ])
  })

  it('goes back to text after a list without a blank line', () => {
    expect(richBlocks('1. 材料を発注する\n2. 1045を分ける\nどちらにしますか。')).toEqual([
      { kind: 'numbers', items: ['材料を発注する', '1045を分ける'], start: 1 },
      { kind: 'paragraph', lines: ['どちらにしますか。'] },
    ])
  })

  it('keeps the number a list starts from when blank lines split it', () => {
    expect(richBlocks('1. 一つ目\n\n2. 二つ目')).toEqual([
      { kind: 'numbers', items: ['一つ目'], start: 1 },
      { kind: 'numbers', items: ['二つ目'], start: 2 },
    ])
  })

  it('keeps line breaks inside a paragraph and drops heading marks', () => {
    expect(richBlocks('## 結論\n納期に間に合います。\n残業は増えません。')).toEqual([
      { kind: 'paragraph', lines: ['結論', '納期に間に合います。', '残業は増えません。'] },
    ])
  })
})

describe('boldRuns', () => {
  it('splits bold from plain text and leaves a lone pair of asterisks as text', () => {
    expect(boldRuns('案を選ぶ観点：**納期**を守る')).toEqual([
      { text: '案を選ぶ観点：', bold: false },
      { text: '納期', bold: true },
      { text: 'を守る', bold: false },
    ])
    expect(boldRuns('****')).toEqual([{ text: '****', bold: false }])
  })
})
