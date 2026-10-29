"""Append the notebook layout revision while retaining the previous audit."""
from configure import configure
ROOT, _ = configure('lesson_revision_record')
from datetime import datetime, timezone
from pathlib import Path
from html import escape
import json
import shutil
from fraudgt_lab.config import digest
from fraudgt_lab.storage import write_json
from corrected_runtime import source_manifest

manifest = json.loads((ROOT/'lesson_layout_manifest.json').read_text())
checks = json.loads((ROOT/'lesson_layout_verification.json').read_text())
assert checks['status'] == 'pass'
assert source_manifest() == manifest['source_sha256_before']
for row, check in zip(manifest['notebooks'], checks['cases']):
    assert digest(row['path']) == check['notebook_sha256']

archive = ROOT/'notebook_backups'/manifest['utc']
archive.mkdir(parents=True, exist_ok=True)
for name in ['verification.json', 'verify_notebooks.py', 'make_notebooks.py']:
    shutil.copy2(ROOT/name, archive/name)
(ROOT/'make_notebooks.py').write_text('''"""Generate the current short-cell lesson notebooks."""
from pathlib import Path
import runpy

if __name__ == "__main__":
    runpy.run_path(str(Path(__file__).with_name("make_lesson_notebooks.py")), run_name="__main__")
''')
(ROOT/'verify_notebooks.py').write_text('''"""Verify the current notebook layout in isolated fresh kernels."""
from pathlib import Path
import runpy

if __name__ == "__main__":
    runpy.run_path(str(Path(__file__).with_name("verify_lesson_notebooks.py")), run_name="__main__")
''')

now = datetime.now(timezone.utc).isoformat()
record = {
    'utc': now, 'event': 'notebook_layout_revision', 'status': 'pass',
    'reference': manifest['reference'],
    'changes': ['short sequential cells', 'data and graph tensor preview', 'model structure',
                'callbacks and fit', 'epoch DataFrame', 'separate loss and ACC plots',
                'validation prediction preview with omitted-target rows preserved'],
    'model_training_source_changed': False,
    'training_started_by_revision': False,
    'notebooks': manifest['notebooks'], 'verification': checks,
}
write_json(ROOT/'lesson_revision_record.json', record)
with (ROOT/'verification_journal.jsonl').open('a') as stream:
    stream.write(json.dumps(record, ensure_ascii=False)+'\n')
ordered = json.loads((ROOT/'ordered_verification_results.json').read_text())
ordered.append({'order': len(ordered)+1, 'utc': now, 'test': '09_cnn_assignment_notebook_layout',
                'status': 'pass', 'detail': checks})
write_json(ROOT/'ordered_verification_results.json', ordered)
verification = json.loads((ROOT/'verification.json').read_text())
verification['notebook_sha256'] = {row['path']: digest(row['path']) for row in manifest['notebooks']}
verification['notebook_layout_revision'] = record
verification['notebook_helpers_sha256'] = {
    name: digest(ROOT/name) for name in ['lesson_runtime.py', 'notebook_display.py', 'make_lesson_notebooks.py', 'verify_lesson_notebooks.py']
}
write_json(ROOT/'verification.json', verification)

rows = ''.join(f'<tr><td>{row["mode"]}</td><td>{row["cells"]}</td><td>{row["code_cells"]}</td><td>{row["longest_code_cell"]}</td><td>PASS</td></tr>' for row in manifest['notebooks'])
links = ''.join(f'<li><a href="{Path(row["canonical"]).name}">{"개별 그래프 실습형" if row["mode"]=="disjoint" else "공유그래프 실습형"}</a></li>' for row in manifest['notebooks'])
page = f'''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>V10 실습 노트북 구성 변경</title>
<style>body{{font:16px/1.7 system-ui;max-width:950px;margin:40px auto;padding:0 24px;color:#24344b}}table{{border-collapse:collapse;width:100%}}th,td{{padding:12px;border-bottom:1px solid #ccd6e1;text-align:left}}code{{background:#eef2f6}}a{{color:#1757a6}}</style>
<h1>V10 실습 노트북 구성 변경</h1><p>{now}</p>
<p>참고 파일: <code>{escape(manifest['reference'])}</code></p>
<p>라이브러리·설정 → 데이터 준비 → 그래프 DataLoader → 모델 구조 → 손실·콜백 → 학습 → 결과 DataFrame → loss·ACC·탐지율 그래프 → best 모델의 예측 예시 순서로 재구성했습니다.</p>
<ul>{links}</ul>
<table><tr><th>방식</th><th>전체 셀</th><th>코드 셀</th><th>최대 코드 줄 수</th><th>새 커널 실행</th></tr>{rows}</table>
<p>핵심 학습 코드14개 파일은 SHA256이 수정 전과 동일합니다. 개별/공유 그래프, V10 입력, 배치2,048, epoch500, BCE[1,6], 누적8, 공식 검증 주기를 유지했습니다. 화면·예측 예시 도우미만 분리했습니다. 진행 게이지와 실시간 그래프도 유지합니다.</p>
<p>두 노트북의 저장된 RUN_TRAINING=True 설정을 보존했습니다. 이 구성 변경 검증에서는 별도 실행 이름과 False 설정으로 실행하여 학습을 시작하지 않았습니다. 사용자가 실행 중인 커널과 체크포인트는 수정하지 않았습니다. 열려 있던 편집기에서는 파일을 다시 열어 새 구성을 확인하세요.</p>
<p>공유 노트북의 디스크 파일에는 이전 official_loader_001 코드가 저장돼 있었습니다. 그 파일을 백업한 뒤, 직전 수정에서 확정한 shared_corrected_001 조건으로 새 구성을 적용했습니다. 이전 실행의 결과를 새 조건과 합치지 않습니다.</p>
<p>실제8건 그래프의 입력 크기·관계 구성을 확인했고, 누락되거나 순서가 바뀐 예측도 원래 거래 ID와 라벨에 정확히 연결되는지 확인했습니다. 미판정 거래는 NaN으로 남깁니다.32건 예측은 확인용이며 목표 P70/R65 성능 검증이 아닙니다.</p>
<p>생성 중 canonical 복사본의 source 자료형 오류를 수정한 뒤 두 파일을 다시 생성하고 전체 실행했습니다.</p>
<p><a href="lesson_layout_verification.json">이번 검증 결과</a> · <a href="ordered_verification_results.json">누적 순서별 기록</a> · <a href="노트북_조건수정_검증기록.html">이전 조건 검증</a></p></html>'''
(ROOT/'노트북_구성변경_기록.html').write_text(page)
report = ROOT/'노트북_조건수정_검증기록.html'
html = report.read_text()
if 'lesson-layout-update' not in html:
    insert = '<section id="lesson-layout-update"><h2>후속 변경: 과제형 셀 구성</h2><p>52개 셀의 단계별 실습 구성으로 재정리했습니다. 학습 코드는 유지했습니다. <a href="노트북_구성변경_기록.html">최신 구성·실행 안내와 검증 기록</a>을 확인하세요. 아래 내용은 이전 조건 수정 시점의 기록입니다.</p></section>'
    html = html.replace('<section>', insert+'<section>', 1)
    report.write_text(html)
print(json.dumps({'status': 'pass', 'core_source_unchanged': True, 'notebook_cells': 52, 'max_code_lines': 23}, ensure_ascii=False))
