import { Fragment, type ReactNode } from 'react'

// Renders the small part of Markdown Claude tends to use in short replies:
// paragraphs, "- " lists and **bold**.
export function RichText({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/)
  return (
    <>
      {blocks.map((block, index) => {
        const lines = block.split('\n')
        if (lines.every((line) => /^\s*[-・*]\s/.test(line))) {
          return (
            <ul key={index}>
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{inline(line.replace(/^\s*[-・*]\s/, ''))}</li>
              ))}
            </ul>
          )
        }
        return (
          <p key={index}>
            {lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 && <br />}
                {inline(line.replace(/^#+\s*/, ''))}
              </Fragment>
            ))}
          </p>
        )
      })}
    </>
  )
}

function inline(line: string): ReactNode[] {
  return line.split(/(\*\*[^*]+\*\*)/).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part,
  )
}
