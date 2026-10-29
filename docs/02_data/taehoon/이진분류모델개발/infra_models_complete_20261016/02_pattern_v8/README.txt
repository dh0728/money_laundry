nine_class 전체 재현 인계 패키지

00_weights_only.ipynb: 가중치+전처리 그래프 NPZ로 CPU/GPU 직접 추론
02_pattern_v8.ipynb: 원본 입력 검증→전처리→그래프→모델→JSON 전체 실행
settings.json: 입력 경로, 기간, device(cpu/cuda)
assets/: 피처 순서·뜻·텐서 명세·보정값(Parquet와 CSV)
examples/: 합성 원본 입력, 원본 모델에서 추출한 기준 그래프 2개
tests/: 두 종류 테스트의 기대 출력
environment.json: 실제 검증 환경
requirements.txt / requirements-cuda126.txt: 고정 의존성

모든 실행 코드는 ipynb 안에 있습니다. 단독 .pt만으로 실행하지 마세요. 각 폴더를 통째로 복사하세요. 상위 인프라_재현_가이드.md와 피처_순서_전처리.md를 참고하세요.

입력피처_의미_순서_전처리.ipynb: 피처 명세 + 실행 코드 + 수식 대조 + 텐서 확인 전용 노트북
