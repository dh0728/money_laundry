// 데이터를 어디서 가져오는지. 기본은 mock이며 VITE_API_MODE=live 로 실행하면 실제 API를 부른다.
export const live = import.meta.env.VITE_API_MODE === 'live'

/** mock 모드에서 처리 결과 알림 아래에 붙이는 문구 */
export const mockSavedNote = '시연용 mock이라 서버에는 저장되지 않습니다.'
