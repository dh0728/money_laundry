import type { Meta, StoryObj } from '@storybook/react-vite'
import { ShellChrome } from './ui/ShellChrome'

const meta = {
  title: 'Chrome/Header + Sidebar',
  component: ShellChrome,
  args: { theme: 'light', accent: 'sky' },
  argTypes: {
    theme: { control: 'select', options: ['light', 'dark', 'solarized-light', 'solarized-dark'] },
    accent: { control: 'select', options: ['sky', 'violet', 'pink', 'lime'] },
  },
} satisfies Meta<typeof ShellChrome>

export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
