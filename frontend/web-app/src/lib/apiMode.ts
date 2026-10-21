// fixture는 개발 서버 또는 명시적인 정적 시연 빌드에서만 합성 응답을 공급한다.
export const fixture = import.meta.env.VITE_API_MODE === 'fixture'
  && (import.meta.env.DEV || import.meta.env.VITE_STATIC_DEMO === 'true')
export const live = import.meta.env.VITE_API_MODE === 'live' || fixture

/** mock 모드에서 처리 결과 알림 아래에 붙이는 문구 */
export const mockSavedNote = '시연용 mock이라 서버에는 저장되지 않습니다.'
