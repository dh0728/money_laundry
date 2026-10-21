import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import { plugin as shadcn } from '@shadcn/lint'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // shadcn/ui 원본 파일과 테마 provider는 variant·hook을 컴포넌트와 함께 내보낸다
    files: ['src/components/ui/**/*.tsx', 'src/components/data-table/**/*.tsx', 'src/app/ThemeProvider.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    // shadcn/ui 원본(사이드바 skeleton의 Math.random, use-mobile의 첫 측정)은 고치지 않고 둔다
    files: ['src/components/ui/sidebar.tsx', 'src/hooks/use-mobile.ts'],
    rules: { 'react-hooks/purity': 'off', 'react-hooks/set-state-in-effect': 'off' },
  },
  {
    // v24 시안의 자금 흐름 그래프를 동작 그대로 옮긴 파일이다. 시안의 lint 기준으로 만들어져 아래 규칙만 예외로 둔다.
    // 고칠 때는 v24 동작(시간순 재생·hop·소유주별 보기·상세 패널)을 화면에서 다시 확인한다.
    files: ['src/features/graph/v24/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  {
    // TanStack Table 타입 확장(module augmentation)은 제네릭 이름을 원본과 똑같이 둬야 한다
    files: ['src/types/data-table.ts'],
    rules: { '@typescript-eslint/no-unused-vars': 'off' },
  },
  {
    // 새 UI(src/next)만 디자인 시스템 규칙을 지킨다. 기존 시연 화면은 전환 전까지 손대지 않는다.
    files: ['src/next/**/*.{ts,tsx}'],
    plugins: { shadcn },
    settings: {
      shadcn: {
        ui: '@/next/ui',
        note: '색·간격·글자 크기는 src/next/styles 토큰과 src/next/ui 컴포넌트만 쓴다.',
      },
    },
    rules: {
      'shadcn/no-raw-colors': 'error',
      'shadcn/no-arbitrary-values': 'error',
      'shadcn/no-restyle': 'error',
      'shadcn/no-inline-styles': 'error',
      'shadcn/no-unknown-classes': 'error',
      'shadcn/require-static-classes': 'error',
    },
  },
  {
    // 컴포넌트 원본은 스스로의 모양을 정의하므로 restyle 검사에서 뺀다
    files: ['src/next/ui/**/*.tsx'],
    rules: { 'shadcn/no-restyle': 'off' },
  },
])
