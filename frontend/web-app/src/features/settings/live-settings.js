import { getJson, postJson } from '@/api/common';

// 서비스 모드에서 설정 화면이 쓰는 서버 호출.
const bandsPath = '/api/v1/settings/model-risk-bands';

export async function fetchLiveRiskBands() {
  const { medium, high } = await getJson(bandsPath);
  return [medium, high];
}

export async function saveLiveRiskBands([medium, high]) {
  try {
    await postJson(bandsPath, { medium, high });
    return true;
  } catch {
    return false;
  }
}

export async function changeLiveRole(id, role) {
  try {
    return { ok: true, value: await postJson(`/api/v1/settings/team/${id}/role`, { role }) };
  } catch (error) {
    return { ok: false, error: error?.problem?.detail ?? error?.problem?.title ?? '권한을 변경하지 못했습니다.' };
  }
}
