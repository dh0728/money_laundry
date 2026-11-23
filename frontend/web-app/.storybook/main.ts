import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(tsx|jsx)'],
  framework: '@storybook/react-vite',
  core: { disableTelemetry: true },
}

export default config
