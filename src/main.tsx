import '@mantine/core/styles.css'
import './index.css'

import { MantineProvider } from '@mantine/core'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { cssVariablesResolver, theme } from './theme'
import { Root } from './ui/entrance/Root'

// Light only: the app sits next to Excel in a factory office.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} forceColorScheme="light">
      <Root />
    </MantineProvider>
  </StrictMode>,
)
