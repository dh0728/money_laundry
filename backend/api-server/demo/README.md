# Streamlit 조회 시연

기존 백엔드 API의 분석 작업 → 의심 거래 → Alert 상세·버전·그래프를 조회한다.
DB 직접 조회, 가짜 완료 상태, 화면 자체 점수 계산은 하지 않는다.
업로드·분석 시작은 기존 은행 목업/API를 이용한다. 본 화면은 조회 전용이다.

AML Python 환경에서 설치한 뒤 이 디렉터리에서 실행:

```powershell
python -m pip install -r requirements.txt
$env:AML_DEMO_API_URL = 'http://127.0.0.1:8080'
python -m streamlit run app.py --server.address 127.0.0.1 --server.port 8501 --browser.gatherUsageStats false
```

명령의 python은 활성화한 AML 환경의 인터프리터를 뜻한다. 종료는 Ctrl+C.
백엔드 주소는 UI에서도 설정할 수 있다. 원격 주소는 HTTPS, 로컬은 HTTP도 지원한다.
Cloudflare 인증이 있으면 CF_ACCESS_CLIENT_ID/CF_ACCESS_CLIENT_SECRET 환경변수로 제공한다.
시크릿을 파일에 커밋하지 않는다. 인증 환경변수가 있으면 AML_DEMO_API_URL로 지정한 주소만 조회한다.
다른 서버에 연결할 때는 인증 환경변수를 제거하거나 해당 서버의 인증정보와 주소를 함께 재설정한다.
동시 사용자 서비스가 아닌 신뢰된 운영자의 로컬 시연 도구다.

백엔드가 실행 중이어야 하며 완료된 분석 결과가 있어야 상세를 볼 수 있다.
이 화면은 example.com이나 미구성 추론 연결을 완성하지 않는다.
로컬 E2E 실행기는 끝나면 서버를 정리하므로 상시 서버로 사용할 수 없다.
모델 버전에 demo가 있으면 더미로 표시하고, 그 외는 출처 확인 필요로 표시한다.
저장된 Alert 정책을 표시하며 날짜형 보강·L1/L2 조사 기능을 구현했다고 표시하지 않는다.

검증: `python -m unittest discover -s tests -v` (이 디렉터리 기준).
