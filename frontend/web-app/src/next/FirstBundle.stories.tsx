import type { Meta, StoryObj } from '@storybook/react-vite'
import { WorkspaceProvider } from './WorkspaceProvider'
import { Dashboard } from './Dashboard'
import { Login } from './App'
import { Appearance, AppShell, type Theme, type Accent } from './ui/AppShell'
import { selectDashboard, type Scope } from './dashboard-data'

function FirstBundle({ theme, accent, screen, state }: { theme: Theme; accent: Accent; screen: 'login' | Scope; state: 'ready' | 'loading' | 'empty' | 'error' | 'initial-error' }) {
  const appearance = <Appearance theme={theme} accent={accent} onTheme={() => {}} onAccent={() => {}} />
  return <WorkspaceProvider><div data-ui="aml-app" data-theme={theme} data-accent={accent}>
    {screen === 'login' ? <Login expired={state === 'error'} onLogin={() => {}} appearance={appearance} /> : <AppShell scope={screen} theme={theme} accent={accent} sidebarOpen onToggle={() => {}} onLogout={() => {}} appearance={appearance} query="" onSearch={() => {}} actions={null}><Dashboard scope={screen} data={selectDashboard(screen, '2026-11-09', '2026-11-15', '', state === 'empty')} start="2026-11-09" end="2026-11-15" query="" state={state} onRetry={() => {}} onRange={() => {}} onClearSearch={() => {}} onClear={() => {}} /></AppShell>}
  </div></WorkspaceProvider>
}
const meta = {
  title: 'App/First bundle', component: FirstBundle,
  args: { theme: 'light', accent: 'sky', screen: 'mine', state: 'ready' },
  argTypes: {
    theme: { control: 'select', options: ['light', 'dark', 'solarized-light', 'solarized-dark'] },
    accent: { control: 'select', options: ['sky', 'violet', 'pink', 'lime'] },
    screen: { control: 'select', options: ['login', 'mine', 'all'] },
    state: { control: 'select', options: ['ready', 'loading', 'empty', 'error', 'initial-error'] },
  },
} satisfies Meta<typeof FirstBundle>
export default meta
type Story = StoryObj<typeof meta>
export const Mine: Story = {}
export const All: Story = { args: { screen: 'all' } }
export const SignIn: Story = { args: { screen: 'login' } }
export const Loading: Story = { args: { state: 'loading' } }
export const Empty: Story = { args: { state: 'empty' } }
export const RefetchError: Story = { args: { state: 'error' } }
export const FirstLoadError: Story = { args: { state: 'initial-error' } }
