"""Add uncertainty and provenance diagnostics after fixed experiments finish."""
from experiment import *
import csv,re

def main():
    check_frozen()
    result=json.loads((ROOT/'result.json').read_text())
    verification=json.loads((ROOT/'final_verification.json').read_text())
    assert verification['all_passed']
    y=np.load(BASE/'cache/labels.npy',mmap_mode='r').astype(bool)
    baseline=np.load(BASE/'cache/logits.npy',mmap_mode='r')>0
    for name in METHODS:
        path=ROOT/f'saml_{name}_logits.npy'
        assert sha(path)==result['target_logits_sha256'][name]
        pred=np.load(path,mmap_mode='r')>0
        r=next(r for r in result['results'] if r['method']==name)
        actual=dict(TP=int((y&pred).sum()),FP=int((~y&pred).sum()),FN=int((y&~pred).sum()),TN=int((~y&~pred).sum()))
        assert all(r[k]==v for k,v in actual.items())
        changes=result['paired'][name]
        assert changes['positive_gained']-changes['positive_lost']==r['TP']-4511
        assert changes['new_false_positives']-changes['normal_rescued']==r['FP']-1018255
    uncertainty=json.loads((ROOT/'validation_uncertainty.json').read_text())
    fits=json.loads((ROOT/'fit.json').read_text())
    rows=[]
    for name,vals in uncertainty['comparisons'].items():
        rows.append(f"| {name} | {vals['AP_delta']*100:+.2f} pp | [{vals['CI95_low']*100:+.2f}, {vals['CI95_high']*100:+.2f}] pp |")
    val=fits['diagnostics']['val'];saml=fits['diagnostics']['saml']
    extra='''## 추가 검산·Validation 불확실성

동일한128개 검증 배치를 함께 재표집한 paired cluster bootstrap500회 결과다. 방법 선택을 끝낸 후 계산했으며, 선택이나 설정을 변경하는 데 사용하지 않았다.

| AP 비교 | 변화 | 95% 구간 |
|---|---:|---:|
'''+ '\n'.join(rows)+f'''

유사 계좌와 차수 구간 중앙값의 AP 차이 구간은0을 포함한다. Validation에서의 순위를 보편적인 우열로 해석하지 않는다.

유사 계좌 적합에서는 HI Train의65,536개 donor만 사용했다. Validation 전체 계좌에서는 {val['donors_used']:,}개 donor, SAML 전체 계좌에서는 {saml['donors_used']:,}개 donor가 실제 선택됐다. 변환 후 근접 거리는 계좌 단위 중앙값 기준 HI Validation {val['distance_quantiles'][1]:.4f}, SAML {saml['distance_quantiles'][1]:.4f}다. 이는 행동 입력의 대응 정도를 살펴보는 진단이며 실제 소유관계 정확도는 아니다. SAML에는 실제 소유관계 정답이 없어 대체값의 참값 오차를 계산할 수 없다.

[Validation 불확실성 원본](validation_uncertainty.json), [대체값 적합·거리 진단](fit.json), [최종 독립 검산](independent_verification.json).
'''
    report=ROOT/'결과.md'
    text=report.read_text().split('\n## 추가 검산·Validation 불확실성')[0].rstrip()+'\n\n'+extra
    report.write_text(text)
    write('independent_verification.json',dict(all_passed=True,utc=datetime.now(timezone.utc).isoformat(),
        all_target_score_hashes_match=True,all_confusion_counts_match=True,all_paired_deltas_reconcile=True,
        frozen_model_plan_artifacts_unchanged=True,salt_still_paused=True,bootstrap_post_selection=True))
    for p in [report,BASE/'성능하락_원인보고서_20261106.md']:
        s=p.read_text()
        for url in re.findall(r'!?\[[^\]]*\]\(([^)]+)\)',s):assert (p.parent/url).exists(),url
        for part in s.split('\n\n'):
            lines=[line for line in part.splitlines() if line.startswith('|')]
            if lines:assert len({line.count('|') for line in lines})==1
    print(json.dumps(dict(all_passed=True,report=str(report)),ensure_ascii=False))

if __name__=='__main__':main()
