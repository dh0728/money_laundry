"""Produce the predeclared comparison after both complete test populations."""
from experiment import *
from html import escape
from fraudgt_lab.storage import write_csv

def run():
    verify_contract();rows=[];comparisons={}
    for scope in ('hi_test','saml'):
        folder=OUT/'evaluation'/scope;done=read(folder/'complete.json')
        assert done['selection']==read(OUT/'frozen_selection.json')
        assert done['scores_sha256']==digest(folder/'scores.npy')
        result=read(folder/'comparison.json');comparisons[scope]=result
        for name in ('original_34','common_23'):rows.append(dict(scope=scope,model=name,**result[name]))
    write_csv(OUT/'전체_비교지표.csv',rows)
    cells=''.join('<tr>'+''.join(f'<td>{escape(str(v))}</td>' for v in [r['scope'],r['model'],f"{r['AP']*100:.4f}%",f"{r['precision']*100:.4f}%",f"{r['recall']*100:.4f}%",f"{r['F1']*100:.4f}%",f"{r['FP']:,}"] )+'</tr>' for r in rows)
    delta=comparisons['saml']['delta'];epoch=read(OUT/'frozen_selection.json')['selected_epoch']
    interpretation=('공통 23종 재학습 후 SAML AP가 상승했다. 없는 피처에 대한 학습 의존을 줄이는 접근을 지지한다.' if delta['AP']>0 else
        '공통 23종 재학습 후 SAML AP의 개선을 확인하지 못했다. 이 피처 제거와 재학습 조건만으로 일반화 문제를 해결하지 못했다.')
    html=f'''<!doctype html><html lang="ko"><meta charset="utf-8"><title>Multi-FraudGT 공통 23종 재학습 결과</title>
<style>body{{max-width:1100px;margin:40px auto;font-family:sans-serif;line-height:1.7}}table{{border-collapse:collapse;width:100%}}td,th{{padding:10px;border:1px solid #ddd;text-align:right}}th{{background:#eef3fa}}p{{max-width:1000px}}</style>
<h1>Multi-FraudGT 공통 23종 재학습 결과</h1><p>HI-Large 학습 · 완료 284에폭 · HI 검증으로 선택한 에폭 {epoch} · SAML 학습 및 임계값 조정 없음.</p>
<p>{interpretation} SAML AP 변화는 {delta['AP']*100:+.4f} pp, F1 변화는 {delta['F1']*100:+.4f} pp다. 단일 시드 실험이며 결제방식·패턴·관측 기간 차이가 남아 있어 결측이 유일한 원인이라는 결론은 내릴 수 없다.</p>
<table><tr><th>평가</th><th>모델</th><th>AP</th><th>Precision</th><th>Recall</th><th>F1</th><th>FP</th></tr>{cells}</table>
<p>임계값은 두 모델 모두 확률 0.5 초과다. HI Test 33,429,507건, SAML-D 전체 9,504,852건을 평가했다. 각 데이터에서 원본 모델과 동일한 거래 순서·그래프·샘플러 시드를 사용했다.</p>
<p>제외: 계좌 유형 6종, 소유관계 3종, 국가 정보 2종. 결제방식 8차원 원핫 및 Unknown 처리는 기존과 동일하다. Port·ego 구조 입력도 유지했다.</p>
<p>학습은 기존 500에폭 학습률 곡선의 앞 284에폭으로 예산을 맞췄다. 학습·중간 검증은 기존 official readout, 최종 전체 평가는 all_targets readout을 사용했다. 기존과 동일한 기간 말 누적 그래프를 쓰므로 실시간 인과 추론 성능으로 해석하지 않는다.</p>
<p><a href="전체_비교지표.csv">전체 지표 CSV</a> · <a href="evaluation/saml/pattern_metrics.csv">SAML 패턴별 탐지</a> · <a href="피처_포함제외.csv">피처 명세</a> · <a href="plan.json">고정 실험 계획</a></p></html>'''
    (OUT/'결과.html').write_text(html)
    write(OUT/'complete.json',dict(status='complete',utc=utc(),selection=read(OUT/'frozen_selection.json'),
        comparisons=comparisons,report_sha256=digest(OUT/'결과.html'),plan_sha256=digest(OUT/'plan.json')))
    event('report_complete',saml_AP_delta_pp=delta['AP']*100)

if __name__=='__main__':run()
