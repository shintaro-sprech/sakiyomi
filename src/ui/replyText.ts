// The small part of Markdown Claude tends to use in short replies: paragraphs, "- " and "1. "
// lists, and **bold**. As in Markdown, a list may start right under a line of text, with no
// blank line between, and a numbered list keeps the number it starts from.
export type RichBlock =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'numbers'; items: string[]; start: number }

const BULLET = /^\s*[-・*]\s+/
const NUMBER = /^\s*(\d+)[.)]\s+/

export function richBlocks(text: string): RichBlock[] {
  const blocks: RichBlock[] = []
  for (const chunk of text.trim().split(/\n\s*\n/)) {
    let last: RichBlock | null = null
    for (const line of chunk.split('\n')) {
      const number = NUMBER.exec(line)
      if (number) {
        const item = line.slice(number[0].length)
        if (last?.kind === 'numbers') last.items.push(item)
        else blocks.push((last = { kind: 'numbers', items: [item], start: Number(number[1]) }))
      } else if (BULLET.test(line)) {
        const item = line.replace(BULLET, '')
        if (last?.kind === 'bullets') last.items.push(item)
        else blocks.push((last = { kind: 'bullets', items: [item] }))
      } else if (line.trim()) {
        const text = line.replace(/^#+\s*/, '')
        if (last?.kind === 'paragraph') last.lines.push(text)
        else blocks.push((last = { kind: 'paragraph', lines: [text] }))
      }
    }
  }
  return blocks
}

// Splits a line into plain text and **bold** runs.
export function boldRuns(line: string): { text: string; bold: boolean }[] {
  return line
    .split(/(\*\*[^*]+\*\*)/)
    .filter((part) => part !== '')
    .map((part) => (part.startsWith('**') && part.endsWith('**') && part.length > 4 ? { text: part.slice(2, -2), bold: true } : { text: part, bold: false }))
}
