import { Fragment, type ReactNode } from 'react'

import { boldRuns, richBlocks } from './replyText'

// Renders Claude's short replies: paragraphs, lists and **bold** (see replyText.ts).
export function RichText({ text }: { text: string }) {
  return (
    <>
      {richBlocks(text).map((block, index) => {
        if (block.kind === 'numbers') {
          return (
            <ol key={index} start={block.start === 1 ? undefined : block.start}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{inline(item)}</li>
              ))}
            </ol>
          )
        }
        if (block.kind === 'bullets') {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{inline(item)}</li>
              ))}
            </ul>
          )
        }
        return (
          <p key={index}>
            {block.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 && <br />}
                {inline(line)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </>
  )
}

function inline(line: string): ReactNode[] {
  return boldRuns(line).map((run, index) => (run.bold ? <strong key={index}>{run.text}</strong> : <Fragment key={index}>{run.text}</Fragment>))
}
