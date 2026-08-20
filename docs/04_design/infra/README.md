# 인프라 아키텍처 결정 기록

이 문서는 인프라 후보 비교, 선택 결과와 선택 근거를 기록한다. 기술 자체의 기초 개념은 각 항목에 연결된 개념 문서에서 설명한다.

- [편집 가능한 Draw.io 아키텍처 다이어그램](architecture.drawio)
- [확정된 인프라 결정 HTML 문서](html/index.html)

## 아키텍처 원칙

- 초기 비용과 운영 복잡도를 현재 프로젝트 규모에 맞게 낮춘다.
- AWS를 사용하되 AWS 전용 기능에 불필요하게 종속되지 않는다.
- Docker, Ubuntu와 표준 프로토콜처럼 다른 환경에서도 사용할 수 있는 기술을 우선한다. 백엔드 프레임워크와 DB 엔진은 아직 미정이다.
- 실제 멀티 클라우드를 운영하지 않더라도 애플리케이션의 이동 가능성을 유지한다.
- 이식성을 위한 복잡성이 실제 이점보다 크면 과도한 추상화를 피한다.
- 적합성, 비용, 운영 부담, 클라우드·도구 종속성과 이전 난이도로 각 후보를 평가한다.
- 핵심 빌드·테스트·배포 명령은 특정 CI 서비스의 YAML이 아닌 Makefile이나 스크립트로 분리한다.

## 결정 현황

| 단계 | 결정 영역 | 현재 결과 | 개념 문서 |
|---|---|---|---|
| 1 | 클라우드 | **AWS** | [클라우드 개념](01-cloud.md) |
| 2 | 서버 | **EC2 단일 인스턴스** | [서버 개념](02-server.md) |
| 3 | 운영체제 | **Ubuntu LTS** | [운영체제 개념](03-operating-system.md) |
| 4 | 컨테이너 실행 | **Docker Compose** | [컨테이너 개념](04-container-runtime.md) |
| 5 | 소스 저장소 | **GitHub** | [소스 저장소 개념](05-source-repository.md) |
| 6 | CI | **GitHub Actions + GitHub 제공 Runner** | [CI 개념](06-ci.md) |
| 7 | 이미지 저장소 | **Docker Hub 비공개 Repository** | [이미지 저장소 개념](07-image-registry.md) |
| 8 | CD 방식 | **SSM Run Command + 배포 스크립트** | [CD 개념](08-cd.md) |
| 9 | Reverse Proxy | **Nginx 컨테이너** | [Reverse Proxy 개념](09-reverse-proxy.md) |
| 10 | HTTPS 인증서 | **Let's Encrypt + Certbot** | [HTTPS 인증서 개념](10-https-certificate.md) |
| 11 | 프론트 배포 | **동일 EC2의 정적 SPA Nginx 컨테이너** | [프론트 배포 개념](11-frontend-deployment.md) |
| 12 | 백엔드 | 미정 | [백엔드 개념](12-backend.md) |
| 13 | DB 종류 | 미정 | [DB 개념](13-database-type.md) |
| 14 | DB 실행 위치 | **동일 EC2의 Docker 컨테이너** | [DB 실행 위치 개념](14-database-location.md) |
| 15 | 파일 저장 | **Amazon S3** | [파일 저장 개념](15-file-storage.md) |
| 16 | 비동기 작업 | **Amazon SQS Standard Queue** | [비동기 작업 개념](16-async-jobs.md) |
| 17 | 캐시 | 미정 | [캐시 개념](17-cache.md) |
| 18 | 비밀정보 | **로컬 `.env` + 운영 Parameter Store `SecureString`** | [비밀정보 개념](18-secrets.md) |
| 19 | 로그·모니터링 | **Amazon CloudWatch 최소 구성** | [로그·모니터링 개념](19-observability.md) |
| 20 | DNS | **Cloudflare DNS 무료 플랜(DNS-only)** | [DNS 개념](20-dns.md) |
| 21 | 인프라 코드 | 미정 | [IaC 개념](21-infrastructure-as-code.md) |

---

## 1. 클라우드 - AWS

### 선택지

- **AWS**
- 네이버 클라우드 플랫폼(NCP)
- Google Cloud Platform(GCP)
- Microsoft Azure

### 비교

| 항목 | AWS | NCP | GCP | Azure |
|---|---|---|---|---|
| 현재 프로젝트 적합성 | 높음 | 보통 | 보통 | 보통 |
| 초기 비용 | 교육 크레딧 활용 가능 | 계약·프로모션에 따라 다름 | 크레딧 조건에 따라 다름 | 크레딧 조건에 따라 다름 |
| 자료와 운영 사례 | 매우 풍부함 | 국내 자료가 강점 | 풍부함 | 풍부함 |
| 글로벌 확장 | 매우 유리 | 상대적으로 제한적 | 유리 | 유리 |
| 종속성 | 사용하는 서비스에 따라 증가 | 사용하는 서비스에 따라 증가 | 사용하는 서비스에 따라 증가 | 사용하는 서비스에 따라 증가 |

### 선택 근거

- AWS 교육 계정 크레딧을 6개월 동안 활용해 초기 비용을 줄일 수 있다.
- 공식 문서, 커뮤니티 자료와 운영 사례가 풍부하다.
- 해외 리전 배포와 글로벌 확장 가능성이 있다.
- GPU 연산은 별도 외부 GPU 서버에서 처리하므로 AWS GPU 인스턴스는 고려하지 않는다.

### 종속성을 줄이기 위한 원칙

- 애플리케이션은 Docker 컨테이너로 패키징한다.
- 핵심 로직이 AWS SDK나 AWS 전용 이벤트 형식에 직접 묶이지 않게 한다.
- 관리형 서비스는 운영 효율, 비용과 이전 난이도를 비교한 뒤 도입한다.
- 중요 데이터는 표준 형식으로 백업한다.

### 감수할 단점

- 크레딧 종료 후 실제 운영 비용이 발생한다.
- AWS 권한과 서비스에 대한 학습이 필요하다.
- AWS 전용 기능이 늘수록 다른 환경으로 이전하기 어려워진다.

### 재검토 조건

- 크레딧 종료 후 비용 경쟁력이 크게 떨어질 때
- 회사 계약이나 보안 정책이 다른 환경을 요구할 때
- 완전한 폐쇄망 또는 온프레미스 배포가 핵심 요구가 될 때

### 문서용 결론

> 메인 클라우드는 AWS를 사용한다. 교육 계정 크레딧과 풍부한 운영 자료를 활용하되, 애플리케이션은 표준 기술과 컨테이너 중심으로 구성하여 이전 가능성을 유지한다.

---

## 2. 서버 - EC2 단일 인스턴스

### 선택지

- **EC2 단일 인스턴스**
- AWS Lightsail
- ECS/Fargate

### 비교

| 항목 | EC2 단일 인스턴스 | Lightsail | ECS/Fargate |
|---|---|---|---|
| 현재 규모 적합성 | 높음 | 높음 | 낮음~보통 |
| 구성 자유도 | 높음 | 보통 | 높음 |
| 운영 부담 | 보통 | 낮음~보통 | 플랫폼 운영은 낮지만 구성 학습 필요 |
| 자동 확장 | 직접 구성 | 제한적 | 유리 |
| AWS 종속성 | 낮음~중간 | 중간 | 높음 |
| 이전 난이도 | 비교적 낮음 | 보통 | 배포 구성 재작성 가능성 큼 |

### 선택 결과

**Ubuntu 기반 AWS EC2 단일 인스턴스를 선택한다.**

### 선택 근거

- 현재는 소규모 프로젝트이므로 서버 한 대가 비용과 복잡도에 적합하다.
- 일반 가상 머신이라 다른 클라우드 서버와 구조가 유사하다.
- Docker Compose로 필요한 컨테이너들을 한 서버에서 실행할 수 있다.
- 자동 확장과 다중 서버 운영 기능은 아직 필요하지 않다.

### 종속성을 줄이기 위한 원칙

- 실행 환경은 Docker 이미지와 Compose 파일로 정의한다.
- EC2 내부에만 존재하는 중요한 영구 데이터를 최소화한다.
- 서버 설정 절차를 문서나 스크립트로 재현할 수 있게 한다.

### 감수할 단점

- 인스턴스 한 대가 중단되면 전체 서비스가 중단될 수 있다.
- 운영체제 패치, 디스크 관리와 장애 대응을 직접 해야 한다.
- 자동 확장과 무중단 배포가 기본 제공되지 않는다.

### 재검토 조건

- 단일 장애 지점을 허용할 수 없게 될 때
- CPU와 메모리가 지속적으로 부족할 때
- 서비스별 독립 확장이나 무중단 배포가 필요할 때

### 문서용 결론

> 초기 서버는 Ubuntu 기반 AWS EC2 단일 인스턴스로 구성한다. 현재 규모에 단순하고 경제적이며, 일반 가상 머신과 Docker 기반이라 다른 환경으로 이전하기도 비교적 쉽다.

---

## 3. 운영체제

### 선택지

- Ubuntu LTS
- Amazon Linux

### 비교

| 항목 | Ubuntu LTS | Amazon Linux |
|---|---|---|
| 여러 환경에서 사용 | 매우 쉬움 | 주로 AWS에서 사용 |
| Docker 관련 자료 | 매우 풍부함 | 풍부함 |
| AWS 통합 | 충분함 | 매우 좋음 |
| 클라우드 종속성 | 낮음 | 중간 |
| 다른 클라우드 이전 | 쉬움 | 운영체제 변경 가능성 있음 |

### 선택 결과

**Ubuntu LTS를 선택한다.** 구체적인 버전은 필요한 소프트웨어 호환성을 확인한 뒤 고정한다.

### 선택 근거

- AWS 외 다른 클라우드와 온프레미스에서도 사용할 수 있다.
- Docker와 일반 서버 소프트웨어 관련 자료가 풍부하다.
- 개발 환경과 운영 환경을 유사하게 구성하기 쉽다.
- Amazon Linux보다 운영체제 수준의 클라우드 종속성이 낮다.

### 종속성을 줄이기 위한 원칙

- 일반적인 Linux 명령과 Ubuntu 표준 패키지를 우선한다.
- 수동 설정을 최소화하고 변경 절차를 기록한다.
- 애플리케이션 의존성은 Docker 이미지에서 고정한다.

### 감수할 단점

- 보안 업데이트와 재부팅 시점을 직접 관리해야 한다.
- 오래된 LTS에서는 최신 패키지를 별도로 설치해야 할 수 있다.

### 재검토 조건

- 필요한 소프트웨어가 선택 버전을 지원하지 않을 때
- 회사 표준 운영체제가 별도로 정해질 때
- 보안 지원 종료에 따라 다음 LTS로 올려야 할 때

### 문서용 결론

> 서버 운영체제는 Ubuntu LTS를 사용한다. 여러 환경에서 사용할 수 있고 Docker 자료가 풍부하여 운영과 이전에 유리하다.

---

## 4. 컨테이너 실행

### 선택지

- Docker Compose
- AWS ECS/Fargate
- Kubernetes/EKS

### 비교

| 항목 | Docker Compose | ECS/Fargate | Kubernetes/EKS |
|---|---|---|---|
| 단일 서버 적합성 | 매우 높음 | 보통 | 낮음 |
| 초기 난이도 | 낮음 | 중간 | 높음 |
| 자동 확장 | 직접 구현 | 지원 | 지원 |
| 다중 서버 관리 | 지원하지 않음 | 지원 | 지원 |
| 종속성 | 낮음 | AWS 종속 | Kubernetes는 이식 가능하나 운영 복잡도 높음 |
| 현재 규모 적합성 | 매우 높음 | 과도할 수 있음 | 과도함 |

### 선택 결과

**EC2 단일 인스턴스에서 Docker Compose를 사용한다.**

### 선택 근거

- 서버가 한 대이고 실행할 서비스 수가 적다.
- 클러스터 없이 초기 비용과 운영 복잡도를 낮출 수 있다.
- Docker를 지원하는 다른 가상 서버에서도 구성을 재사용할 수 있다.
- 자동 확장과 다중 서버 관리가 아직 필요하지 않다.

### 종속성을 줄이기 위한 원칙

- 환경 설정과 비밀정보는 이미지 외부에서 주입한다.
- 서비스마다 health check와 restart policy를 설정한다.
- 중요한 영구 데이터를 컨테이너 내부에만 저장하지 않는다.
- Compose 파일에 불필요한 AWS 전용 설정을 넣지 않는다.

### 감수할 단점

- 여러 서버에 컨테이너를 자동 배치할 수 없다.
- 서버 장애가 모든 컨테이너에 영향을 준다.
- 무중단 배포와 자동 복구를 직접 구성해야 한다.

### 재검토 조건

- 다중 서버 분산, 자동 확장 또는 무중단 배포가 필요할 때
- 독립 운영해야 하는 서비스 수가 크게 늘어날 때

### 문서용 결론

> 컨테이너 실행은 Docker Compose를 선택한다. 현재의 단일 EC2에 충분하며 비용과 운영 부담이 낮다. 다중 서버 요구가 생기면 ECS 또는 Kubernetes를 재검토한다.

---

## 5. 소스 저장소

### 선택지

- GitHub
- GitLab

### 비교

| 항목 | GitHub | GitLab |
|---|---|---|
| 코드 리뷰 | Pull Request | Merge Request |
| 직접 연동 CI | GitHub Actions | GitLab CI/CD |
| 관리형 서비스 | 제공 | 제공 |
| 자체 구축 | 별도 Enterprise 구성 | Self-Managed 구성 |
| 외부 생태계 | 매우 풍부함 | 풍부함 |

### 선택 결과

**GitHub를 선택한다.**

### 선택 근거

- 현재 프로젝트 저장소가 GitHub에 있다.
- Pull Request 기반 코드 리뷰와 브랜치 보호를 적용할 수 있다.
- GitHub Actions와 자연스럽게 연결된다.
- 별도 Git 서버를 운영하지 않아도 된다.

### 종속성을 줄이기 위한 원칙

- 코드와 문서는 표준 Git 파일로 관리한다.
- 핵심 자동화 명령을 GitHub Actions YAML 밖으로 분리한다.
- 중요한 운영 지식을 GitHub 화면에만 남기지 않는다.

### 감수할 단점

- GitHub 장애와 정책 변경의 영향을 받는다.
- GitHub.com은 완전한 폐쇄망에서 사용할 수 없다.
- 전용 기능을 많이 사용하면 다른 Git 서버로 이전할 때 작업이 늘어난다.

### 재검토 조건

- 완전한 폐쇄망이나 사내 Git 저장소가 요구될 때
- 규정상 외부 SaaS에 코드를 저장할 수 없을 때

### 문서용 결론

> 소스 저장소는 GitHub를 사용한다. Git 기반 협업과 GitHub Actions 연동에 적합하며, 핵심 자산은 표준 Git 파일로 관리해 이전 가능성을 유지한다.

---

## 6. CI

### 선택지

- GitHub Actions
- Jenkins

### 비교

| 항목 | GitHub Actions | Jenkins |
|---|---|---|
| GitHub 연동 | 매우 쉬움 | 별도 연결 필요 |
| 초기 구축 | 낮음 | 높음 |
| 운영 부담 | GitHub 제공 Runner 사용 시 낮음 | 높음 |
| 제한된 사내망 | Self-hosted Runner로 대응 가능 | 가능 |
| 완전한 폐쇄망 | GitHub.com 기반 구성은 부적합 | 내부 Git과 함께 가능 |
| 도구 종속성 | 워크플로 구성에 따라 중간 | Pipeline과 플러그인에 따라 중간 |

### 선택 결과

**GitHub Actions와 GitHub 제공 Runner를 선택한다.**

### 선택 근거

- GitHub 저장소의 Pull Request와 Push 이벤트에 바로 연결할 수 있다.
- 별도의 Jenkins 서버를 설치하고 유지할 필요가 없다.
- 소규모 프로젝트의 lint, test와 build 자동화에 충분하다.
- 폐쇄망은 현재 확정 요구가 아니므로 Jenkins를 지금 구축하는 것은 과도하다.

### 종속성을 줄이기 위한 원칙

- `make lint`, `make test`, `make build`, `make image` 같은 공통 명령을 만든다.
- Actions YAML은 공통 명령을 호출하는 얇은 연결 계층으로 사용한다.
- Marketplace Action 사용을 필요한 범위로 제한한다.
- CI와 실제 운영 배포인 CD를 분리한다.

### 감수할 단점

- GitHub 장애와 Runner 사용 정책의 영향을 받는다.
- Self-hosted Runner도 GitHub.com과 외부 통신해야 한다.
- 완전한 폐쇄망 전환 시 CI와 저장소 구성을 함께 바꿔야 할 수 있다.

### 재검토 조건

- 인터넷이 완전히 차단된 환경에서 빌드해야 할 때
- 외부 관리형 Runner 사용이 보안 정책상 금지될 때
- 전용 하드웨어나 내부 시스템 접근이 필요할 때
- 사내 표준 Jenkins와 전담 운영 인력이 제공될 때

### 문서용 결론

> CI는 GitHub Actions와 GitHub 제공 Runner를 사용한다. 제한된 사내망에서는 Self-hosted Runner를 검토하고, 완전한 폐쇄망에서는 동일한 공통 스크립트를 Jenkins에서 실행할 수 있게 한다.

---

## 7단계 이후 결정 기록

각 항목에는 후보와 비교 기준을 먼저 기록한다. 결정이 끝난 항목에는 선택 결과, 선택 근거, 감수할 단점과 재검토 조건을 추가하고, 아직 결정하지 않은 항목은 선택 결과를 `미정`으로 표시한다.

## 7. 이미지 저장소

### 선택지 정보

- **Amazon ECR**: AWS IAM과 EC2 연동이 편리한 AWS 관리형 레지스트리다.
- **Docker Hub**: 클라우드와 무관하게 널리 사용하는 컨테이너 레지스트리다.
- **GHCR**: GitHub 저장소, 조직 권한과 Actions를 연결하기 편리하다.

| 항목 | ECR | Docker Hub | GHCR |
|---|---|---|---|
| 주요 연동 | AWS | Docker 생태계 | GitHub |
| 클라우드 중립성 | 중간 | 높음 | 중간~높음 |
| 권한 기준 | AWS IAM | Docker 조직 | GitHub 조직 |
| 이전 시 작업 | 이미지 복사·인증 변경 | 이미지 복사·인증 변경 | 이미지 복사·인증 변경 |

### 선택 결과

**Docker Hub의 비공개 Repository를 사용한다.**

GitHub Actions가 애플리케이션 이미지를 빌드해 Docker Hub로 Push하고, EC2의 배포 스크립트가 지정된 버전의 이미지를 Pull한다.

```text
GitHub Actions → Docker Hub → EC2 → Docker Compose
       Push         Pull       컨테이너 갱신
```

### 선택 근거

- Docker 및 Docker Compose와 자연스럽게 연동되며 초기 구성이 단순하다.
- AWS 계정과 분리된 레지스트리이므로 다른 클라우드나 온프레미스 서버에서도 같은 이미지 경로를 사용할 수 있다.
- 현재처럼 이미지와 배포 대상 서버 수가 적은 프로젝트에 별도의 레지스트리 운영이 필요 없다.
- 팀원에게 익숙한 표준 `docker login`, `docker push`, `docker pull` 명령을 그대로 사용할 수 있다.

### 종속성을 줄이기 위한 원칙

- 빌드와 Push 명령은 GitHub Actions YAML에 길게 작성하지 않고 Makefile이나 공통 스크립트로 분리한다.
- 운영 배포는 `latest` 대신 Git commit SHA 또는 고유 버전 태그를 사용한다.
- 이미지 이름과 Registry 주소는 환경변수로 관리해 다른 Registry로 변경할 수 있게 한다.
- Docker Hub 개인 비밀번호 대신 범위를 제한한 Access Token을 사용한다.
- 운영 이미지는 공개 Repository가 아닌 비공개 Repository에 저장한다.

### 감수할 단점

- EC2가 이미지를 내려받으려면 Docker Hub와 외부 네트워크 통신이 가능해야 한다.
- Docker Hub 장애, 정책 변경 또는 Pull 제한의 영향을 받을 수 있다.
- GitHub Actions와 EC2 양쪽에 Docker Hub 인증정보를 안전하게 설정해야 한다.
- 완전한 폐쇄망에서는 Docker Hub를 직접 사용할 수 없다.

### 재검토 조건

- 완전한 폐쇄망이나 인터넷 연결이 제한된 사내망에 배포해야 할 때
- 이미지 Pull 제한이나 외부 전송 속도가 실제 배포에 영향을 줄 때
- AWS IAM 기반의 세밀한 권한 통합이 필요해 ECR의 운영상 이점이 커질 때
- GitHub 조직 권한으로 이미지와 소스 권한을 통합할 필요가 생길 때

### 문서용 결론

> 현재 이미지 저장소는 Docker Hub의 비공개 Repository를 사용한다. GitHub Actions가 고유 버전 태그로 이미지를 Push하고 EC2는 배포 시 해당 이미지를 Pull한다. Registry 주소와 빌드·배포 명령은 공통 설정과 스크립트로 분리해 향후 ECR, GHCR 또는 사내 Registry로 이전할 수 있게 한다.

## 8. CD 방식

### 선택지

- **SSH**: CI나 관리자가 서버에 접속해 배포 스크립트를 실행한다.
- **SSM Run Command**: AWS 관리 채널과 IAM을 통해 EC2에서 명령을 실행한다.
- **CodeDeploy**: AWS가 배포 단계와 실행 이력을 관리하는 배포 서비스다.

### 비교

| 항목 | SSH | SSM Run Command | CodeDeploy |
|---|---|---|---|
| 초기 구성 | 낮음 | 중간 | 중간~높음 |
| 운영 접근 | SSH 키·네트워크 | IAM·SSM Agent | IAM·Agent와 배포 설정 |
| 배포 이력 | 직접 기록 | 실행 기록 | 배포 단위 기록 |
| AWS 종속성 | 낮음 | 높음 | 높음 |

### 선택 결과

**GitHub Actions에서 SSM Run Command로 EC2의 공통 배포 스크립트를 실행한다.**

```text
GitHub Actions
  → SSM Run Command
  → EC2의 배포 스크립트
  → docker compose pull
  → docker compose up -d
  → Health check
  → 실패 시 이전 이미지로 복구
```

### 선택 근거

- CI가 EC2에 접근하도록 SSH 22번 포트를 외부에 공개하지 않아도 된다.
- 장기간 사용하는 SSH 개인 키를 GitHub에 보관하지 않고 IAM으로 배포 권한을 통제할 수 있다.
- 명령 실행 상태와 이력을 AWS에서 확인할 수 있다.
- 현재의 단일 EC2와 Docker Compose 환경에서 CodeDeploy보다 구성 요소가 적다.
- SSH 직접 배포보다 접근 통제가 명확하면서 현재 규모에 과도하지 않다.

### 종속성을 줄이기 위한 원칙

- SSM은 배포 명령을 EC2에 전달하는 역할만 담당한다.
- 이미지 내려받기, Compose 갱신, Health check와 복구는 저장소의 공통 셸 스크립트로 구현한다.
- GitHub Actions Workflow에는 긴 배포 명령을 직접 작성하지 않고 공통 스크립트를 호출한다.
- 배포 스크립트는 SSM, SSH와 Jenkins 중 어느 방식으로 실행해도 같은 결과가 나도록 작성한다.
- 배포할 이미지의 고유 태그를 명시하고 `latest` 태그에만 의존하지 않는다.
- SSM 명령 인자와 로그에 비밀번호나 토큰 같은 비밀정보를 평문으로 전달하지 않는다.

```text
SSM Run Command ─┐
SSH ─────────────┼─> scripts/deploy.sh <image-tag>
Jenkins ─────────┘
```

### 감수할 단점

- SSM Agent, IAM과 Systems Manager 통신 설정이 필요하다.
- 배포 명령 전달 계층은 AWS Systems Manager에 종속된다.
- SSM이나 AWS 제어 영역에 장애가 발생하면 새 배포를 실행하기 어렵다.
- 자동 롤백은 SSM 자체에 맡기지 않고 배포 스크립트에서 직접 구현해야 한다.
- 완전한 폐쇄망에서는 GitHub Actions와 AWS API를 이용한 현재 구성을 그대로 사용할 수 없다.

### 재검토 조건

- 완전한 폐쇄망에서 배포해야 할 때
- AWS가 아닌 가상 서버로 이전할 때
- 여러 서버에 동시 배포하거나 복잡한 배포 순서를 관리해야 할 때
- 무중단 Blue/Green 또는 Canary 배포가 필요할 때
- 배포 스크립트만으로 롤백과 배포 이력을 관리하기 어려워질 때
- 사내 표준 Jenkins 배포 환경과 운영 인력이 제공될 때

### 문서용 결론

> CD는 AWS Systems Manager Run Command를 사용한다. GitHub Actions는 IAM 권한으로 대상 EC2에 명령을 전달하고, EC2에서는 공통 배포 스크립트가 이미지 내려받기, Docker Compose 갱신, Health check와 실패 시 복구를 수행한다. SSH 포트를 외부에 공개하지 않고 실행 이력을 관리할 수 있다는 장점이 있다. 실제 배포 절차는 SSM에서 분리된 셸 스크립트로 작성하여 향후 SSH 또는 Jenkins에서도 재사용할 수 있게 한다.

## 9. Reverse Proxy

### 선택지

- **Nginx**: 자료가 풍부하고 세밀하게 설정할 수 있는 범용 Reverse Proxy다.
- **Caddy**: 설정이 간결하고 자동 HTTPS 기능이 강점이다.
- **Traefik**: 컨테이너와 동적 서비스 발견에 초점을 둔다.
- **ALB**: 여러 서버 분산과 상태 확인을 제공하는 AWS 관리형 로드밸런서다.

### 비교

| 항목 | Nginx | Caddy | Traefik | ALB |
|---|---|---|---|---|
| 운영 위치 | 서버 | 서버 | 서버·클러스터 | AWS 관리형 |
| 자동 HTTPS | 별도 구성 | 강점 | 지원 | ACM 연동 |
| 동적 컨테이너 발견 | 기본 수동 | 제한적 | 강점 | 대상 등록 방식 |
| 종속성 | 낮음 | 낮음 | 낮음 | 높음 |
| 별도 비용 | 서버 자원 | 서버 자원 | 서버 자원 | 지속 비용 |

### 선택 결과

**Nginx를 Docker Compose 서비스로 실행한다.**

```text
사용자
  → Nginx 컨테이너
      ├─ /api/* → Backend API 컨테이너
      └─ 그 외 요청 → Frontend
```

실제 Frontend 요청을 Nginx가 직접 제공할지 별도 프론트 배포 위치로 전달할지는 프론트 배포 단계에서 결정한다.

### 선택 근거

- 단일 EC2와 Docker Compose 구성에 필요한 Reverse Proxy 기능을 충분히 제공한다.
- 설정 파일을 소스 저장소에서 버전 관리하고 다른 가상 서버에서도 재사용할 수 있다.
- 경로 또는 도메인에 따라 내부 서비스로 요청을 전달할 수 있다.
- Backend 컨테이너의 포트를 인터넷에 직접 공개하지 않아도 된다.
- 자료와 운영 사례가 풍부해 설정 및 장애 원인을 찾기 쉽다.
- Traefik의 동적 서비스 발견과 ALB의 다중 서버 분산 기능은 현재 규모에 필요하지 않다.
- HTTPS 인증서 방식을 Nginx 선택과 분리해 다음 단계에서 결정할 수 있다.

### 종속성을 줄이기 위한 원칙

- Nginx를 EC2 호스트에 직접 설치하지 않고 Docker Compose 서비스로 정의한다.
- Nginx 설정 파일을 저장소에서 버전 관리한다.
- AWS 전용 주소나 메타데이터 대신 Compose 서비스 이름으로 내부 컨테이너에 연결한다.
- Nginx만 외부 HTTP·HTTPS 포트를 사용하고 Backend와 Worker 포트는 외부에 공개하지 않는다.
- 설정 변경 전 `nginx -t`로 문법을 검사한다.
- 접근 로그는 표준 출력과 표준 오류로 보내 향후 로그 수집 방식을 바꾸기 쉽게 한다.

### 감수할 단점

- Nginx 설정과 버전 업데이트를 직접 관리해야 한다.
- 인증서 발급과 갱신은 별도로 구성해야 한다.
- Nginx 컨테이너나 EC2가 중단되면 모든 외부 요청이 영향을 받는다.
- 컨테이너 추가 시 라우팅 설정을 직접 변경하고 다시 적용해야 한다.
- 여러 EC2 사이의 자동 부하 분산과 관리형 상태 확인 기능은 제공되지 않는다.

### 재검토 조건

- EC2가 여러 대로 늘어나 서버 간 트래픽 분산이 필요할 때
- Auto Scaling과 연동해 대상 서버를 자동 등록해야 할 때
- 관리형 Health check와 TLS 종료가 운영상 더 유리해질 때
- 컨테이너 수와 변경 빈도가 늘어 동적 서비스 발견이 필요할 때
- 무중단으로 Nginx 자체를 이중화해야 할 때

### 문서용 결론

> Reverse Proxy는 Nginx를 Docker Compose 서비스로 실행한다. 외부 HTTP·HTTPS 요청은 Nginx만 받고 내부 서비스에는 Compose 네트워크와 서비스 이름을 통해 전달한다. Nginx 설정은 소스 저장소에서 버전 관리하여 다른 클라우드나 온프레미스에서도 재사용할 수 있게 한다. 다중 EC2, Auto Scaling 또는 관리형 로드밸런싱이 필요해지면 ALB를 재검토한다.

## 10. HTTPS 인증서

### 선택지

- **Let's Encrypt**: 무료 공개 인증서를 발급하며 자동 갱신을 구성할 수 있다.
- **AWS ACM**: ALB와 CloudFront 같은 AWS 서비스에서 인증서 관리를 단순화한다.
- **유료 인증서**: 조직 검증, 계약상 지원이나 특정 규정이 필요할 때 검토한다.

### 비교

| 항목 | Let's Encrypt | ACM | 유료 인증서 |
|---|---|---|---|
| 비용 | 무료 | 서비스 유형에 따라 확인 | 유료 |
| 갱신 | 자동화 구성 | 지원 AWS 서비스에서 관리 | 상품에 따라 다름 |
| EC2 Proxy 직접 적용 | 가능 | 유형·구성 제약 확인 | 가능 |
| 종속성 | 낮음 | AWS 종속 | 인증기관 종속 |

### 선택 결과

**Let's Encrypt에서 인증서를 발급하고 Certbot으로 발급과 갱신을 자동화한다.**

Nginx와 Certbot은 Docker Compose 서비스로 실행하며 인증서 파일과 ACME 검증 파일을 영구 Volume으로 공유한다.

```text
HTTP 80
  ├─ /.well-known/acme-challenge/* → Certbot 검증 파일
  └─ 그 외 요청 → HTTPS로 Redirect

HTTPS 443
  → Nginx
  → 내부 애플리케이션 컨테이너
```

### 선택 근거

- 공개적으로 신뢰받는 TLS 인증서를 무료로 발급할 수 있다.
- Certbot과 ACME를 이용해 발급과 갱신을 자동화할 수 있다.
- EC2에서 직접 실행하는 Nginx에 인증서 파일을 연결할 수 있다.
- ALB 또는 CloudFront 없이도 현재 단일 EC2 구조에서 HTTPS를 제공할 수 있다.
- AWS 전용 인증서 서비스에 의존하지 않아 다른 클라우드나 일반 서버에서도 같은 방식을 사용할 수 있다.
- 유료 인증서가 제공하는 조직 검증이나 별도 계약 지원은 현재 요구사항이 아니다.

### 운영 원칙

- 실제 소유한 공개 도메인의 DNS가 EC2 Public IP를 가리키게 한다.
- EC2 보안 그룹에서 외부 `80`, `443` 포트 접근을 허용한다.
- HTTP-01 검증 경로를 제외한 HTTP 요청은 HTTPS로 Redirect한다.
- 인증서와 Private key는 컨테이너의 임시 쓰기 영역이 아닌 영구 Volume에 저장한다.
- Nginx와 Certbot에는 필요한 인증서 및 검증 경로만 공유한다.
- Certbot 갱신을 정기 실행하고 성공 후 Nginx가 새 인증서를 읽도록 Reload한다.
- 인증서 갱신 실패와 만료 예정 상태를 확인할 운영 절차를 둔다.
- Private key를 Git 저장소, Docker 이미지나 로그에 포함하지 않는다.

### 감수할 단점

- 초기 인증서 발급과 자동 갱신 구성을 직접 만들어야 한다.
- HTTP-01 방식을 사용하려면 공개 DNS와 외부에서 접근 가능한 80번 포트가 필요하다.
- 갱신 작업이나 Nginx Reload가 실패하면 인증서가 만료될 수 있다.
- Docker Volume의 인증서 파일 권한과 백업을 직접 관리해야 한다.
- 인터넷이 차단된 폐쇄망에서는 Let's Encrypt에 접근해 인증서를 발급하거나 갱신할 수 없다.

### 재검토 조건

- ALB 또는 CloudFront에서 TLS 연결을 종료하도록 구조가 변경될 때
- 여러 EC2에서 동일한 공개 인증서를 관리해야 할 때
- 규정이나 고객 계약상 조직 검증 인증서 또는 특정 상용 CA가 필요할 때
- 80번 포트를 공개할 수 없어 DNS-01 등 다른 검증 방식이 필요할 때
- 완전한 폐쇄망에서 내부 도메인용 인증서를 사용해야 할 때

### 폐쇄망 전환 방향

완전한 폐쇄망에서는 Let's Encrypt 대신 조직이 운영하는 사내 CA가 발급한 인증서를 사용한다. Nginx의 TLS 처리 구조는 유지하고 인증서 발급 및 갱신 주체만 사내 인증 체계로 교체한다.

### 문서용 결론

> HTTPS 인증서는 Let's Encrypt에서 발급하고 Certbot으로 자동 갱신한다. Nginx와 Certbot은 Docker Compose 서비스로 실행하며 인증서와 ACME 검증 파일을 영구 Volume으로 공유한다. 외부 HTTP 요청은 인증서 검증 경로를 제외하고 HTTPS로 Redirect하고, 인증서 갱신 후 Nginx를 Reload한다. 완전한 폐쇄망에서는 Nginx 구성을 유지하면서 Let's Encrypt를 사내 CA 인증서로 교체한다.

## 11. 프론트 배포

### 선택지

- **Nginx 컨테이너**: 빌드된 정적 파일을 EC2 안에서 제공한다.
- **S3 + CloudFront**: 정적 파일 저장과 CDN 전송을 EC2에서 분리한다.
- **Vercel**: 프론트 빌드, 미리보기, 배포와 CDN을 제공하는 외부 플랫폼이다.

### 비교

| 항목 | Nginx 컨테이너 | S3 + CloudFront | Vercel |
|---|---|---|---|
| 정적 SPA | 가능 | 매우 적합 | 적합 |
| SSR | 별도 서버 필요 | 정적 파일만으로 불가 | 지원 범위가 강점 |
| EC2 장애 영향 | 받음 | 분리 | 분리 |
| 종속성 | 낮음 | AWS 종속 | Vercel 종속 |

### 선택 결과

**프론트엔드는 정적 SPA로 빌드하고, 빌드 결과물을 포함한 별도 Nginx 컨테이너를 Backend와 동일한 EC2에서 실행한다.**

```text
EC2 단일 인스턴스
└─ Docker Compose
   ├─ nginx-proxy       외부 80/443, HTTPS와 요청 분기
   ├─ frontend          정적 HTML·CSS·JavaScript 제공
   ├─ backend           API 제공
   └─ worker            비동기 작업이 필요할 때 실행
```

```text
https://서비스도메인/api/* → nginx-proxy → backend
https://서비스도메인/*     → nginx-proxy → frontend
```

`nginx-proxy`는 외부 요청을 내부 서비스로 전달하는 Reverse Proxy이고, `frontend`의 Nginx는 정적 파일을 반환하는 Web Server다. 이 구성에는 Forward Proxy가 없다.

### 선택 근거

- 프론트가 AML 담당자가 로그인 후 사용하는 대시보드와 업무 화면이므로 검색엔진을 위한 SSR 필요성이 낮다.
- EC2를 추가하지 않고 기존 단일 인스턴스의 Docker Compose 안에서 실행할 수 있다.
- 빌드된 정적 파일만 제공하므로 운영 중인 Node.js 프론트 서버가 필요하지 않고 자원 사용량이 작다.
- 프론트와 Backend 이미지를 분리해 독립적으로 빌드하고 배포할 수 있다.
- Reverse Proxy 설정과 프론트 정적 파일 배포를 서로 분리할 수 있다.
- Docker를 실행할 수 있는 다른 클라우드나 폐쇄망 서버에서도 같은 구성을 사용할 수 있다.
- 현재 규모에서는 S3·CloudFront나 Vercel을 추가하는 운영 복잡도와 종속성의 이점이 크지 않다.

### 운영 및 보안 원칙

- 프론트 이미지는 Node.js 빌드 단계와 Nginx 실행 단계를 분리한 다단계 Dockerfile로 생성한다.
- 운영 Frontend 컨테이너에는 소스와 개발 도구 대신 빌드 결과물과 Nginx만 포함한다.
- Frontend 컨테이너 포트는 인터넷에 직접 공개하지 않고 Compose 내부 네트워크에서만 Reverse Proxy가 접근한다.
- SPA의 클라이언트 경로는 존재하지 않는 파일 요청을 `index.html`로 돌리는 Fallback을 구성한다.
- `/api` 요청은 Reverse Proxy가 Backend 컨테이너로 전달한다.
- DB 비밀번호, AWS Secret Access Key, 외부 GPU 서버 토큰 등 비밀정보를 프론트 코드나 빌드 결과물에 포함하지 않는다.
- 프론트 화면에서 기능을 숨기는 것으로 권한을 통제하지 않고 Backend가 모든 API 요청의 인증과 권한을 검사한다.
- 정적 파일에는 콘텐츠 기반 파일명과 적절한 Cache Header를 사용해 새 버전 배포 시 이전 파일 충돌을 줄인다.

### 감수할 단점

- EC2 장애가 발생하면 프론트와 Backend가 함께 중단된다.
- 프론트 정적 파일 전송도 EC2의 네트워크와 자원을 사용한다.
- CDN을 사용하지 않으므로 해외 사용자에게 정적 파일 전달이 상대적으로 느릴 수 있다.
- Reverse Proxy용과 정적 파일 제공용 Nginx 컨테이너를 각각 관리해야 한다.
- 프론트가 SSR을 요구하게 되면 현재 정적 파일 제공 구조를 변경해야 한다.

### 재검토 조건

- 글로벌 사용자가 늘어나 CDN을 통한 정적 파일 전송이 필요할 때
- 프론트 트래픽을 EC2 장애와 분리해야 할 때
- 정적 파일 트래픽이 EC2 비용이나 성능에 유의미한 영향을 줄 때
- 검색엔진 노출, 서버 렌더링 또는 페이지별 동적 HTML 생성이 필요할 때
- Pull Request별 자동 Preview 환경이 중요한 요구사항이 될 때

### 문서용 결론

> 프론트엔드는 정적 SPA로 빌드하고, 빌드 결과물을 포함한 별도 Nginx 컨테이너를 Backend와 동일한 EC2의 Docker Compose에서 실행한다. 외부 요청은 Reverse Proxy Nginx만 받고 `/api` 요청은 Backend로, 나머지 요청은 Frontend 컨테이너로 전달한다. 민감한 정보와 모든 인증·권한 판단은 Backend가 담당한다. 글로벌 CDN이나 프론트 장애 분리가 필요해지면 S3·CloudFront를 재검토한다.

## 12. 백엔드

### 선택지 정보

- **Spring Boot**: Java/Kotlin 기반으로 구조화된 서버와 기업용 생태계가 강점이다.
- **FastAPI**: Python 기반으로 API 개발과 AI·데이터 라이브러리 연동이 편리하다.
- **NestJS**: TypeScript 기반으로 모듈화된 서버 구조를 제공한다.

| 항목 | Spring Boot | FastAPI | NestJS |
|---|---|---|---|
| 언어 | Java/Kotlin | Python | TypeScript |
| 기본 구조 | 강함 | 가볍고 선택 폭이 큼 | 강함 |
| AI 코드 연결 | 보통 별도 연동 | Python 생태계 강점 | 보통 별도 연동 |
| 초기 학습량 | 비교적 큼 | 비교적 낮음 | 중간 |

**선택 결과: 미정**

## 13. DB 종류

### 선택지 정보

- **PostgreSQL**: 트랜잭션, 표준 SQL과 다양한 데이터 타입을 지원하는 관계형 DB다.
- **MySQL**: 널리 사용되며 운영 자료와 호스팅 선택지가 풍부한 관계형 DB다.
- **MongoDB**: JSON과 유사한 문서 구조를 저장하는 문서형 DB다.

| 항목 | PostgreSQL | MySQL | MongoDB |
|---|---|---|---|
| 모델 | 관계형 | 관계형 | 문서형 |
| 관계·제약조건 | 강함 | 강함 | 애플리케이션 모델링 비중 큼 |
| 구조 유연성 | 마이그레이션 필요 | 마이그레이션 필요 | 상대적으로 유연 |
| 복잡한 SQL | 강점 | 지원 | 별도 집계 문법 |

**선택 결과: 미정**

## 14. DB 실행 위치

### 선택지

- **RDS**: 백업, 패치와 장애 대응 기능 일부를 AWS가 관리한다.
- **같은 EC2의 Docker**: 비용과 구조는 단순하지만 앱과 DB가 같은 장애 영향을 받는다.
- **별도 EC2 직접 운영**: 자원과 장애 영역을 분리하지만 서버와 DB 운영 부담이 커진다.

### 비교

| 항목 | RDS | 같은 EC2 Docker | 별도 EC2 |
|---|---|---|---|
| 비용 | 상대적으로 높음 | 낮음 | 중간 이상 |
| 백업·패치 | 일부 관리 | 직접 관리 | 직접 관리 |
| 앱 장애와 분리 | 가능 | 불가 | 가능 |
| 종속성 | 중간~높음 | 낮음 | 낮음~중간 |

### 선택 결과

**선택할 DB 엔진을 Backend와 동일한 EC2의 Docker 컨테이너에서 실행한다.**

DB 종류는 아직 결정하지 않았으며, PostgreSQL·MySQL·MongoDB 등의 후보를 추가 검토한 뒤 해당 컨테이너 이미지를 확정한다.

```text
EC2 단일 인스턴스
└─ Docker Compose
   ├─ nginx-proxy
   ├─ frontend
   ├─ backend
   ├─ database
   │   └─ 영구 데이터 → EC2 영구 볼륨
   └─ worker

DB 백업 → EC2 외부 저장 위치
```

### 선택 근거

- 초기에는 별도 RDS나 DB 전용 EC2 비용을 부담하지 않아도 된다.
- 단일 EC2와 Docker Compose라는 현재 실행 구조 안에서 함께 관리할 수 있다.
- DB 엔진의 공식 Docker 이미지를 사용하면 개발 환경과 운영 환경을 유사하게 구성할 수 있다.
- DB 엔진과 표준 백업 형식을 유지하면 RDS나 다른 클라우드 DB로 이전할 수 있다.
- 현재 프로젝트 규모에서는 관리형 DB의 고가용성과 자동 운영 기능보다 비용 절감이 우선이다.

### 운영 및 이식성 원칙

- DB 데이터를 컨테이너의 임시 쓰기 영역에 저장하지 않고 EC2의 영구 볼륨에 연결한다.
- DB 컨테이너 포트를 인터넷에 공개하지 않고 Compose 내부 네트워크에서 Backend만 접근하게 한다.
- DB 이미지의 엔진과 버전을 명시하고 `latest` 태그에 의존하지 않는다.
- DB 계정, 비밀번호와 연결 문자열을 이미지나 Compose 파일에 직접 기록하지 않는다.
- 자동 백업을 구성하고 백업 파일은 같은 EC2가 아닌 외부 저장 위치에 보관한다.
- 백업 생성뿐 아니라 별도 환경에서의 복구 시험을 정기적으로 수행한다.
- CPU, 메모리와 디스크 사용량을 관찰해 애플리케이션과 DB가 서로 자원을 고갈시키지 않게 한다.
- DB 엔진 고유 기능을 사용할 때 다른 환경으로 이전할 경우의 대체 방법을 기록한다.

### 감수할 단점

- EC2 장애가 애플리케이션과 DB에 동시에 영향을 준다.
- DB의 설치, 보안 패치, 버전 업그레이드, 백업과 복구를 직접 관리해야 한다.
- EC2 또는 연결된 볼륨이 손상되면 외부 백업 없이는 데이터를 복구하기 어렵다.
- 애플리케이션과 DB가 CPU, 메모리, 디스크 I/O를 공유한다.
- 기본적으로 자동 장애 조치와 고가용성을 제공하지 않는다.

### 재검토 조건

- 실제 사용자 데이터가 쌓여 데이터 손실의 영향이 커질 때
- DB 중단 시간이 서비스 운영상 허용되지 않을 때
- DB 백업, 패치와 장애 대응을 직접 수행하기 어려울 때
- 애플리케이션과 DB의 자원 경쟁이 반복적으로 발생할 때
- 저장 용량이나 I/O 요구가 단일 EC2 범위를 넘어설 때
- 다중 EC2 또는 고가용성 구성을 도입할 때

### 문서용 결론

> DB는 Backend와 동일한 EC2의 Docker Compose에서 별도 컨테이너로 실행한다. DB 종류는 추가 검토 후 결정한다. DB 데이터는 컨테이너 외부의 영구 볼륨에 저장하고 DB 포트는 외부에 공개하지 않는다. 백업은 같은 EC2 밖에 보관하고 실제 복구 절차를 검증한다. 데이터 중요도, 가용성 또는 운영 부담이 커지면 RDS나 별도 DB 서버를 재검토한다.

## 15. 파일 저장

### 선택지

- **S3**: 서버와 분리된 AWS 관리형 객체 스토리지다.
- **EBS**: EC2에 디스크처럼 연결하는 블록 스토리지다.
- **S3 호환 객체 스토리지**: 다른 클라우드나 온프레미스에서도 유사 API를 사용할 수 있다.

### 비교

| 항목 | S3 | EBS | S3 호환 객체 스토리지 |
|---|---|---|---|
| 접근 | 객체 API | 파일 시스템 | 객체 API |
| 서버 분리 | 쉬움 | 서버 연결 중심 | 쉬움 |
| 여러 서버 접근 | 쉬움 | 별도 공유 필요 | 쉬움 |
| 종속성 | AWS 기능 범위에 따라 중간 | AWS 종속 | 상대적으로 낮음 |

### 선택 결과

**실시간 거래 원문과 정규화 거래는 DB에 저장하고, 일정 기간이 지난 원문 이벤트는 시간 또는 건수 단위 파일로 묶어 Amazon S3에 장기 Archive한다.**

거래 1건이 들어올 때마다 작은 S3 객체를 생성하지 않는다. 실시간 처리 경로는 `Backend → SQS → Ingestion Worker → DB`이며 S3는 이 경로와 분리된 장기 보관소로 사용한다.

```text
금융회사 거래 시스템
  → Backend API
  → SQS
  → Ingestion Worker
  → DB
      ├─ 단기 원문 Payload
      └─ 정규화 거래

장기 Archive 작업
  → DB의 오래된 원문 이벤트 조회
  → 시간·건수 단위 JSONL/Parquet 생성
  → S3 Archive 업로드 및 검증
```

### 선택 근거

- 장기 원문을 EC2와 분리해 서버 또는 컨테이너가 교체되어도 유지할 수 있다.
- 거래 1건마다 객체를 만들지 않고 압축된 묶음 파일로 저장해 요청 수와 작은 객체 관리를 줄일 수 있다.
- DB에는 최근 재처리와 오류 조사에 필요한 원문만 유지하고 오래된 원문 Payload를 정리할 수 있다.
- 접근 권한, 객체 버전, 수명 주기와 암호화 같은 파일 관리 기능을 제공한다.
- EC2 장애가 발생해도 S3에 저장한 파일은 함께 사라지지 않는다.

### 운영 및 이식성 원칙

- S3 Archive 구현을 별도 Adapter 또는 Archive 모듈 뒤에 두어 다른 객체 스토리지로 교체할 수 있게 한다.
- AWS SDK 호출이 거래 수집과 모델 추론의 도메인 로직에 퍼지지 않게 한다.
- Archive 객체는 기본 비공개로 두고 운영·감사 목적의 최소 권한만 부여한다.
- Archive 파일에는 기간, 건수, Schema Version과 Checksum을 기록한다.
- 업로드 완료 후 레코드 수와 Checksum을 검증한 뒤에만 DB 원문을 `ARCHIVED`로 표시한다.
- 개발, 검증과 운영 환경의 Bucket 또는 key prefix를 분리한다.
- 원문 Archive의 보존 기간, 삭제, 버전 관리와 수명 주기 정책을 명시한다.
- 거래 원문 Archive와 DB 백업은 목적, 접근 권한과 보존 기간이 다르므로 별도 Bucket 또는 prefix로 분리한다.
- 다른 환경으로 이전할 수 있도록 객체와 메타데이터를 내보내는 절차를 마련한다.

### 감수할 단점

- 애플리케이션이 S3 API와 AWS 인증 체계를 사용하게 된다.
- 저장 용량뿐 아니라 요청 수와 외부 데이터 전송량에 따라 비용이 발생한다.
- EC2의 일반 파일 경로처럼 직접 사용할 수 없어 애플리케이션에서 객체 API를 사용해야 한다.
- 잘못된 Bucket Policy나 객체 권한 설정은 민감한 파일 노출로 이어질 수 있다.
- 완전한 폐쇄망에서는 공개 S3 Endpoint에 접근할 수 없으므로 별도 연결 또는 내부 객체 스토리지가 필요하다.

### 재검토 조건

- 완전한 폐쇄망에서 외부 AWS 서비스에 접근할 수 없을 때
- 회사가 지정한 내부 객체 스토리지나 파일 시스템을 사용해야 할 때
- S3 요청 또는 데이터 전송 비용이 크게 증가할 때
- 다른 클라우드나 온프레미스로 애플리케이션을 이전할 때
- 파일을 POSIX 파일 시스템으로 직접 처리해야 하는 워크로드가 핵심이 될 때

### 문서용 결론

> 실시간 거래 원문과 정규화 거래는 DB에 저장하고, 일정 기간이 지난 원문 이벤트는 시간 또는 건수 단위의 JSONL/Parquet 파일로 묶어 Amazon S3에 장기 Archive한다. 거래 1건마다 S3 객체를 생성하지 않으며 Archive 업로드의 건수와 Checksum을 검증한 후 DB 원문 정리 여부를 결정한다. S3 연동은 별도 Archive Adapter로 격리하고 완전한 폐쇄망에서는 내부 S3 호환 객체 스토리지를 재검토한다.

## 16. 비동기 작업

### 선택지

- **별도 큐 없음**: 구성은 단순하지만 긴 작업의 재시도와 격리가 어렵다.
- **SQS**: 서버 운영 없이 메시지 보관과 재시도를 구성할 수 있는 AWS 큐다.
- **Redis 기반 큐**: 언어별 작업 라이브러리와 Redis를 이용해 내부 큐를 구성한다.
- **RabbitMQ**: 메시지 확인과 다양한 Routing을 제공하는 자체 운영 Message Broker다.
- **Kafka**: 이벤트를 보존하고 여러 Consumer가 재처리할 수 있는 분산 Event Streaming 플랫폼이다.

### 비교

| 항목 | 큐 없음 | SQS | Redis 기반 큐 | RabbitMQ | Kafka |
|---|---|---|---|---|---|
| 초기 복잡도 | 가장 낮음 | 중간 | 중간 | 높음 | 매우 높음 |
| Burst 완충 | 제한적 | 지원 | 지원 | 지원 | 지원 |
| 재시도·실패 격리 | 직접 구현 | Visibility Timeout·DLQ | 라이브러리·구성에 따라 다름 | Ack·DLX 등 구성 | Consumer와 별도 실패 처리 설계 |
| 서버 운영 | 추가 없음 | AWS 관리 | Redis 운영 필요 | Broker 운영 필요 | Cluster 운영 필요 |
| 이벤트 재생 | DB에 의존 | 보존 중 메시지 중심 | 구성에 따라 다름 | Queue 유형에 따라 다름 | 강점 |
| 클라우드 종속성 | 없음 | AWS 종속 | 낮음~중간 | 낮음 | 낮음 |
| 현재 규모 적합성 | 높지만 완충 제한 | 높음 | 보통 | 낮음~보통 | 낮음 |

### 선택 결과

**거래 수집과 DB 적재 사이의 비동기 Queue로 Amazon SQS Standard Queue를 사용한다.**

```text
금융회사 거래 시스템
  → Backend API
  → SQS Standard Queue
  → Ingestion Worker
  → DB에 원문 Payload와 정규화 거래 Micro-batch 저장
  → inference_status = PENDING
  → Model Batch Worker가 PENDING 거래와 연관 거래 조회
  → GNN 입력 그래프 Batch 생성
  → 외부 GPU 서버에 추론 요청
  → 위험 점수·탐지 결과·모델 버전을 DB에 저장
  → inference_status = COMPLETED
```

SQS의 메시지 묶음과 모델 추론 Batch는 서로 다른 개념으로 관리한다.

- **SQS 거래 메시지**: 유입 급증을 완충하고 DB 적재 작업을 전달한다.
- **DB 적재 Micro-batch**: Worker가 짧은 시간 또는 일정 건수만큼 모아 한 번에 DB에 저장한다.
- **모델 추론 Batch**: DB에 저장된 거래를 `event_time` 기준의 업무 시간 구간으로 묶는다.

### 선택 근거

- 순간적인 거래 유입량과 DB의 실제 처리 속도를 분리할 수 있다.
- DB가 일시적으로 느리거나 중단되어도 SQS가 거래 메시지를 일정 기간 보관할 수 있다.
- 별도의 Kafka 또는 RabbitMQ 서버를 구축하고 패치·백업·모니터링하지 않아도 된다.
- Worker가 중단되거나 처리에 실패하면 Visibility Timeout 이후 메시지를 다시 처리할 수 있다.
- 반복 실패 메시지를 Dead-letter queue로 분리할 수 있다.
- 향후 거래 적재 Worker 수를 늘려 처리량을 확장할 수 있다.
- 현재 예상 트래픽에는 Kafka의 장기 이벤트 재생과 분산 Streaming 기능이 과도하다.

### 처리 원칙

- Ingestion API는 거래의 필수 형식과 인증을 검사하고 SQS 저장이 성공한 뒤 접수 응답을 반환한다.
- 모든 거래에는 금융회사 또는 수집 시스템이 생성한 고유 `transaction_id`를 사용한다.
- SQS Standard Queue의 중복 전달 가능성에 대비해 DB의 `transaction_id`에 Unique Constraint를 둔다.
- Worker는 SQS에서 받은 메시지를 건수 또는 짧은 시간 기준으로 모아 DB에 Micro-batch로 저장한다.
- DB Commit이 성공한 이후에만 해당 SQS 메시지를 삭제한다.
- 처리 시간이 Visibility Timeout을 넘을 수 있으면 Timeout을 연장하거나 작업 단위를 줄인다.
- 정해진 횟수 이상 실패한 메시지는 DLQ로 이동하고 원인 확인 및 재처리 절차를 둔다.
- Queue 적체량과 가장 오래된 메시지의 대기 시간을 모니터링한다.
- 메시지 Schema에 `schema_version`, `transaction_id`, `event_time`과 수신 추적 ID를 포함한다.
- SQS 메시지에 비밀번호, 인증 토큰 등 비밀정보를 포함하지 않는다.

### 모델 Batch 원칙

- SQS 도착 순서를 거래 발생 순서로 간주하지 않는다.
- 모델 Batch는 DB의 `event_time`을 기준으로 만들고 지연 도착 거래를 위한 유예 시간을 둔다.
- 동일 timestamp의 거래는 하나의 묶음으로 일괄 예측한 뒤 그래프·Rolling 상태에 반영한다.
- Model Batch Worker는 DB에서 PENDING 거래와 분석에 필요한 연관 거래를 조회해 GNN 입력 그래프를 생성한다.
- GPU 서버에는 DB 접속정보를 주지 않으며, Worker가 추론에 필요한 입력 데이터와 `inference_batch_id`, 모델 버전을 요청으로 전달한다.
- GPU 응답은 Model Batch Worker가 수신하고 위험 점수, 탐지 결과와 실제 모델 버전을 DB에 저장한다.
- `batch_id`와 모델 버전을 이용해 동일 Batch의 중복 추론과 결과 중복 저장을 방지한다.
- 추론 상태는 `PENDING → INFERENCING → COMPLETED`를 기본 흐름으로 하며, 일시 오류는 `RETRY_WAIT`, 최종 실패는 `FAILED`로 기록한다.

### 종속성을 줄이기 위한 원칙

- 메시지 본문은 AWS 전용 구조가 아닌 프로젝트 자체 JSON Schema로 정의한다.
- 메시지 발행과 소비 코드를 Queue Adapter 뒤에 격리해 도메인 로직이 SQS SDK에 직접 의존하지 않게 한다.
- SQS는 거래의 최종 원본 저장소가 아니라 DB 적재 전의 전달·완충 계층으로 사용한다.
- 모델 처리 로직은 Queue 메시지 자체가 아니라 DB에 저장된 정규화 거래와 처리 상태를 기준으로 실행한다.
- S3는 실시간 적재·추론 경로에서 제외하고, 보존 기간이 지난 원문을 시간·건수 단위로 묶어 장기 Archive하는 용도로만 사용한다.
- 완전한 폐쇄망에서는 같은 메시지 Schema와 Worker 로직을 유지하면서 RabbitMQ 등 내부 Broker Adapter로 교체한다.

### 감수할 단점

- SQS API, IAM과 AWS 네트워크 연결에 종속된다.
- Standard Queue에서는 메시지가 중복되거나 순서가 바뀔 수 있어 멱등성 처리가 필수다.
- Queue, DLQ, Visibility Timeout과 재처리 정책을 운영해야 한다.
- API와 DB 사이가 비동기가 되어 접수 직후 DB 조회 결과에 거래가 아직 나타나지 않을 수 있다.
- 현재 API와 Worker가 단일 EC2에 있으므로 EC2 전체 장애 중에는 신규 거래를 받을 수 없다.
- 거래량이 적은 초기 단계에는 DB 직접 적재보다 구성 요소와 디버깅 범위가 늘어난다.

### 재검토 조건

- 완전한 폐쇄망으로 전환해 AWS SQS에 접근할 수 없을 때
- 장기간 이벤트 보존과 여러 독립 Consumer의 과거 재생이 핵심 요구가 될 때
- 매우 높은 지속 처리량과 Partition별 Event Streaming이 필요할 때
- 복잡한 Exchange Routing과 온프레미스 Broker 통제가 필요할 때
- Queue 사용 비용 또는 AWS 종속성이 운영상 문제가 될 때
- API 서버까지 고가용성으로 구성해 EC2 전체 장애 중에도 거래를 받아야 할 때

### 문서용 결론

> 비동기 거래 수집에는 Amazon SQS Standard Queue를 사용한다. Backend API는 거래 메시지를 SQS에 저장한 뒤 접수 응답을 반환하고, Ingestion Worker는 여러 메시지를 짧게 모아 원문 Payload와 정규화 거래를 DB에 Micro-batch로 저장한다. DB Commit 이후에만 메시지를 삭제하며 `transaction_id` 기반 멱등성과 DLQ를 적용한다. Model Batch Worker는 DB의 PENDING 거래와 연관 거래를 조회해 GNN 입력을 만들고 외부 GPU 서버에 추론을 요청한 뒤, 위험 점수·탐지 결과·모델 버전을 DB에 저장한다. S3는 실시간 경로가 아닌 장기 원문 Archive 용도로 사용한다. 완전한 폐쇄망에서는 같은 메시지 Schema와 Worker 로직을 유지하면서 내부 RabbitMQ Adapter를 검토한다.

## 17. 캐시

### 선택지 정보

- **캐시 없음**: 구조가 가장 단순하며 실제 병목이 확인되기 전에는 추가 장애 지점이 없다.
- **직접 운영 Redis**: 메모리 기반 캐시를 직접 설치하고 운영한다.
- **ElastiCache**: AWS가 캐시 서버의 운영 일부를 관리한다.

| 항목 | 캐시 없음 | 직접 운영 Redis | ElastiCache |
|---|---|---|---|
| 복잡도 | 가장 낮음 | 중간 | 중간 |
| 추가 비용 | 없음 | 서버 자원 | 관리형 서비스 비용 |
| 운영 부담 | 없음 | 높음 | 상대적으로 낮음 |
| 종속성 | 없음 | 낮음 | AWS 종속 |

**선택 결과: 미정**

## 18. 비밀정보

### 선택지

- **서버 `.env`**: 단순하고 중립적이지만 전달, 권한과 교체를 직접 관리한다.
- **Parameter Store**: AWS IAM으로 설정과 암호화된 값을 관리한다.
- **Secrets Manager**: 비밀 버전과 교체 기능에 특화된 AWS 관리형 서비스다.

### 비교

| 항목 | `.env` | Parameter Store | Secrets Manager |
|---|---|---|---|
| 초기 구성 | 낮음 | 중간 | 중간 |
| 접근 통제 | OS 권한 | IAM | IAM |
| 자동 교체 | 직접 구현 | 직접 구성 | 기능 활용 가능 |
| 종속성 | 낮음 | AWS 종속 | AWS 종속 |

### 선택 결과

**로컬 개발에서는 Git에 포함하지 않는 `.env`를 사용하고, 운영 비밀정보는 AWS Systems Manager Parameter Store의 `SecureString`으로 관리한다.**

EC2는 IAM Instance Role로 필요한 Parameter만 조회하고, 배포 스크립트가 이를 제한된 권한의 Secret 파일로 만든 뒤 Docker Compose의 `secrets` 기능으로 필요한 컨테이너에만 전달한다.

```text
로컬 개발
  .env → Docker Compose

운영 환경
  Parameter Store SecureString
    → EC2 Instance Role로 조회
    → 제한된 권한의 Secret 파일
    → Docker Compose secrets
    → /run/secrets/*
```

### 설정과 비밀정보 구분

다음과 같이 공개되어도 직접적인 접근 권한이 생기지 않는 일반 실행 설정은 `.env`로 관리할 수 있다.

```text
APP_ENV
LOG_LEVEL
HTTP_PORT
MODEL_BATCH_INTERVAL_SECONDS
AWS_REGION
```

다음과 같은 인증·암호화 값은 운영 `.env`에 저장하지 않고 `SecureString`으로 관리한다.

```text
DB_PASSWORD
JWT_SECRET
GPU_API_TOKEN
외부 서비스 API Key
암호화 Key
```

### 선택 근거

- 개발자는 `.env`로 로컬 환경을 간단히 실행할 수 있다.
- 운영 비밀값은 평문 파일만으로 배포·공유하지 않고 KMS로 암호화해 저장할 수 있다.
- EC2 IAM Role로 Parameter 경로별 최소 읽기 권한을 부여할 수 있다.
- GitHub Actions가 실제 운영 Secret을 알지 않고 SSM으로 배포 명령만 전달할 수 있다.
- 이미 SSM Run Command와 IAM을 사용하므로 새로운 Secret 서버를 별도로 운영할 필요가 없다.
- 자동 교체 기능이 아직 필요하지 않으므로 Secrets Manager의 비용과 구성을 추가하지 않아도 된다.
- Docker Compose Secret 파일을 경계로 두면 애플리케이션이 Parameter Store SDK에 직접 의존하지 않는다.

### 운영 및 보안 원칙

- 실제 값이 없는 `.env.example`만 Git에 저장하고 `.env`와 Secret 파일은 `.gitignore`에 포함한다.
- 개발, 검증과 운영 환경의 Parameter 경로와 값을 분리한다.
- Parameter 이름은 `/project/environment/service/name` 형태의 계층으로 구성한다.
- EC2 Role에는 운영에 필요한 Parameter 경로의 읽기 권한만 부여한다.
- 애플리케이션은 가능하면 환경변수보다 `/run/secrets/*` 파일에서 비밀을 읽는다.
- 호스트의 Secret 파일은 Git 작업 디렉터리 밖에 두고 소유자와 파일 권한을 제한한다.
- Parameter 조회 명령과 배포 스크립트가 비밀값을 표준 출력, Shell Trace와 CloudWatch 로그에 남기지 않게 한다.
- Docker 이미지, Compose 파일, CI Artifact와 S3의 일반 파일 영역에 Secret을 포함하지 않는다.
- 비밀의 이름, 용도, 소유자와 교체 주기는 기록하되 실제 값은 문서에 적지 않는다.
- 유출이 의심되면 파일만 삭제하지 않고 해당 비밀을 폐기하고 새 값으로 교체한다.
- 컨테이너에 모든 Secret을 일괄 전달하지 않고 서비스별로 필요한 항목만 연결한다.

### 감수할 단점

- Parameter Store, IAM과 KMS 설정에 AWS 종속성이 생긴다.
- 배포 과정에서 EC2에 복호화된 Secret 파일이 잠시 또는 실행 중 존재한다.
- Secret 파일 권한, 삭제와 컨테이너 재시작을 직접 관리해야 한다.
- Parameter 값을 변경해도 실행 중인 컨테이너가 자동으로 새 값을 읽는 것은 아니므로 안전한 재시작 절차가 필요하다.
- Parameter Store 자체가 애플리케이션별 자동 교체 Workflow를 제공하는 것은 아니다.
- 완전한 폐쇄망에서는 AWS Parameter Store에 접근할 수 없다.

### 재검토 조건

- DB 비밀번호와 API Key의 자동 교체가 필요할 때
- Secret 사용 기록과 버전 관리에 더 강한 통제가 필요할 때
- 여러 서버와 서비스에 비밀을 동적으로 배포해야 할 때
- AWS 외 클라우드 또는 완전한 폐쇄망으로 이전할 때
- 회사가 지정한 Vault 또는 사내 비밀정보 관리 시스템이 제공될 때
- 평문 Secret 파일이 호스트에 존재하는 것을 보안 정책이 금지할 때

### 폐쇄망 전환 방향

애플리케이션은 `/run/secrets/*` 파일을 읽는 방식을 유지하고, Secret 파일을 만드는 공급자만 교체한다.

```text
현재 AWS
  Parameter Store → Secret 파일 → Docker Compose

폐쇄망
  사내 Secret 저장소 → Secret 파일 → Docker Compose
```

### 문서용 결론

> 로컬 개발에서는 Git에 포함하지 않는 `.env`를 사용하고 운영 비밀정보는 AWS Systems Manager Parameter Store의 `SecureString`으로 관리한다. EC2는 제한된 IAM Role로 필요한 Parameter만 조회하며, 배포 스크립트가 Docker Compose Secret 파일로 필요한 컨테이너에 전달한다. 일반 실행 설정과 비밀정보를 분리하고 실제 Secret을 Git, Docker 이미지와 로그에 포함하지 않는다. 자동 교체가 필요해지면 Secrets Manager를, 완전한 폐쇄망에서는 사내 Secret 저장소를 재검토한다.

## 19. 로그·모니터링

### 선택지

- **Docker 로컬 로그**: 가장 단순하지만 중앙 검색과 서버 외부 보관이 어렵다.
- **CloudWatch**: AWS 자원 메트릭, 로그, 대시보드와 알림을 관리형으로 제공한다.
- **Prometheus/Grafana/Loki**: 메트릭, 시각화와 로그를 오픈소스 구성으로 직접 운영한다.

### 비교

| 항목 | Docker 로컬 | CloudWatch | Prometheus/Grafana/Loki |
|---|---|---|---|
| 초기 구성 | 낮음 | 중간 | 높음 |
| 중앙 검색 | 제한적 | 지원 | 지원 |
| EC2 장애 후 확인 | 로컬 로그 접근 불가 | AWS 외부 서비스에서 상태·기존 로그 확인 가능 | 같은 EC2에 있으면 함께 중단 |
| 소프트웨어 비용 | 없음 | 무료 구간 이후 사용량 기반 | 오픈소스 라이선스 비용 없음 |
| 실제 자원 비용 | EC2 디스크 | 수집·저장·조회 사용량 | EC2 CPU·메모리·디스크 또는 별도 서버 |
| 운영 부담 | 낮지만 기능 제한 | 상대적으로 낮음 | 높음 |
| 종속성 | 없음 | AWS 종속 | 낮음 |

### 선택 결과

**초기 로그·모니터링은 Amazon CloudWatch를 최소 범위로 사용한다.**

EC2 Basic Monitoring을 우선 활용하고, 애플리케이션과 컨테이너에서는 장애 대응에 필요한 로그만 CloudWatch Logs로 전송한다. 상세 메트릭, 로그 종류와 보존 기간은 필요한 범위에서만 추가한다.

```text
EC2 기본 메트릭 ───────────────┐
CloudWatch Agent 추가 메트릭 ──┤
Backend·Worker 핵심 로그 ──────┼─> CloudWatch
Nginx 오류 로그 ────────────────┤     ├─ Dashboard
SQS·DLQ 상태 ───────────────────┘     └─ Alarm
```

### 선택 근거

- EC2가 중단되어도 AWS 외부 서비스에서 인스턴스 상태와 이미 수집된 로그를 확인할 수 있다.
- 현재 단일 EC2에 Prometheus, Grafana, Loki와 수집기까지 추가해 애플리케이션·DB 자원을 소비하지 않아도 된다.
- 별도의 모니터링 서버, 저장소, 업데이트와 백업을 운영할 필요가 없다.
- EC2와 SQS 등 이미 사용하는 AWS 자원의 기본 메트릭을 연결하기 쉽다.
- 초기 규모에서는 무료 사용 범위 또는 적은 사용량 안에서 운영할 가능성이 높다.
- 로그와 메트릭을 필요한 범위로 제한하면 사용량 기반 비용을 통제할 수 있다.

### 초기 수집 범위

#### 메트릭

- EC2 인스턴스 상태 검사, CPU와 네트워크
- CloudWatch Agent를 통한 메모리와 디스크 사용률
- SQS 메시지 적체량과 가장 오래된 메시지의 대기 시간
- DLQ에 들어온 메시지 수
- Backend 요청 오류율과 주요 작업 실패 횟수
- Worker의 DB 적재 및 모델 Batch 성공·실패 수

#### 로그

- Backend `ERROR`·`WARN` 로그
- 거래 수집 및 DB Micro-batch 적재 실패
- Worker와 외부 GPU 서버 호출 실패
- 모델 Batch 생성·완료·실패 이벤트
- SQS 재시도와 DLQ 이동 관련 오류
- Nginx 오류 및 보안상 확인이 필요한 접근 로그
- 배포, Health check와 Rollback 결과

### 비용 및 보안 원칙

- 애플리케이션은 CloudWatch SDK를 직접 호출하지 않고 구조화된 JSON을 표준 출력과 표준 오류로 기록한다.
- 로그 수집 계층이 컨테이너 출력을 CloudWatch Logs로 전달하도록 구성한다.
- Debug 로그는 운영 환경에서 기본 비활성화한다.
- Nginx 정상 접근 로그와 반복적인 성공 로그를 무제한 전송하지 않는다.
- Log Group별 보존 기간을 명시하고 무기한 보관을 기본값으로 사용하지 않는다.
- 로그 수집량, 저장량과 Logs Insights 조회량을 정기적으로 확인한다.
- CloudWatch 예상 비용 또는 AWS 계정 비용에 대한 알림을 구성한다.
- 거래 원문, 계좌번호 전체, 개인정보, 인증 토큰, 비밀번호와 Secret을 로그에 기록하지 않는다.
- 필요한 식별자는 마스킹하거나 내부 추적 ID로 대체한다.
- 로그 열람 권한을 최소화하고 운영 환경의 접근 기록을 남긴다.

### 종속성을 줄이기 위한 원칙

- 로그는 서비스 전용 API 대신 표준 출력의 구조화된 JSON 형식으로 생성한다.
- 요청과 Batch를 연결할 `correlation_id`, `transaction_id`의 비식별 추적값과 `batch_id`를 일관되게 사용한다.
- 애플리케이션 메트릭은 가능한 한 OpenTelemetry 또는 Prometheus 호환 형식으로 노출할 수 있게 구성한다.
- Alarm 조건과 핵심 대시보드 항목을 문서로 관리한다.
- 폐쇄망 전환 시 로그 수집 대상을 Loki로, 메트릭 수집 대상을 Prometheus로 바꿔도 애플리케이션 로깅 코드를 다시 작성하지 않게 한다.

### 감수할 단점

- 무료 사용 범위를 초과하면 로그 수집, 저장, 조회, Custom Metric과 Alarm 비용이 발생한다.
- 로그가 많거나 Label·Dimension을 과도하게 늘리면 예상보다 비용이 커질 수 있다.
- 대시보드, Query와 Alarm 설정이 CloudWatch에 종속된다.
- Prometheus·Grafana 조합과 비교하면 복잡한 자체 대시보드와 장기 메트릭 분석의 자유도가 낮을 수 있다.
- 완전한 폐쇄망에서는 CloudWatch에 로그와 메트릭을 전송할 수 없다.

### 재검토 조건

- CloudWatch 사용 비용이 자체 모니터링 서버 운영 비용보다 커질 때
- 장기간의 고해상도 메트릭과 복잡한 PromQL 대시보드가 필요할 때
- 여러 클라우드와 온프레미스의 시스템을 하나의 관측 환경에 통합해야 할 때
- 규정상 로그를 AWS 외부 또는 완전한 사내망에 보관해야 할 때
- 별도의 모니터링 서버와 이를 운영할 인력 및 자원을 확보했을 때
- 완전한 폐쇄망으로 전환해 CloudWatch를 사용할 수 없을 때

### 폐쇄망 전환 방향

완전한 폐쇄망에서는 애플리케이션의 구조화된 표준 출력 로그를 내부 수집기를 통해 Loki로 보내고, Prometheus가 서버와 애플리케이션 메트릭을 수집하며 Grafana에서 조회하는 구성을 검토한다.

```text
현재 AWS
  stdout·metrics → CloudWatch

폐쇄망
  stdout → 로그 수집기 → Loki ─┐
  metrics → Prometheus ─────────┼─> Grafana
```

### 문서용 결론

> 초기 로그·모니터링에는 Amazon CloudWatch를 최소 범위로 사용한다. EC2 Basic Monitoring을 우선 활용하고 Backend 오류, 거래 적재 실패, Worker·모델 Batch 실패, SQS·DLQ 상태와 Nginx 오류처럼 장애 대응에 필요한 정보만 수집한다. 로그 보존 기간과 Level을 제한하고 비용 알림을 구성한다. 애플리케이션은 CloudWatch에 직접 종속되지 않도록 구조화된 로그를 표준 출력으로 기록하며, 완전한 폐쇄망에서는 같은 로그와 메트릭을 Prometheus·Grafana·Loki 구성으로 전환한다.

## 20. DNS

### 선택지

- **Route 53**: AWS 자원 연동과 라우팅 기능을 제공하는 관리형 DNS다.
- **Cloudflare DNS**: DNS와 선택적인 프록시, CDN, 보안 기능을 제공한다.
- **도메인 등록기관 DNS**: 등록 업체의 기본 DNS로 기능 범위는 업체마다 다르다.

### 비교

| 항목 | Route 53 | Cloudflare DNS | 등록기관 DNS |
|---|---|---|---|
| AWS 연동 | 강점 | 일반 DNS 연결 | 일반 DNS 연결 |
| 프록시·CDN | 별도 서비스 | 선택 가능 | 보통 제한적 |
| 자동화 API | 지원 | 지원 | 업체별 차이 |
| 종속성 | AWS | Cloudflare | 등록기관 |

### 선택 결과

**공개 서비스용 도메인을 구매하고 권한 DNS는 Cloudflare DNS 무료 플랜의 DNS-only 모드로 운영한다.**

도메인의 소유권과 갱신은 6개월 동안 사용하는 AWS 교육 계정과 분리된 장기 유지 계정에서 관리한다. 도메인 구매처는 실제 구매 시 지원하는 최상위 도메인, 최초 등록 가격과 갱신 가격을 확인한 뒤 정한다.

```text
도메인 등록기관
  → 도메인 소유권·연간 갱신
  → Nameserver를 Cloudflare로 지정

Cloudflare DNS-only
  → A Record
  → EC2 고정 Public IP
  → Nginx + Let's Encrypt
```

초기 서비스 주소는 같은 Origin을 사용하는 다음 형태로 구성한다.

```text
https://app.example.com/*      → Frontend
https://app.example.com/api/*  → Backend
```

### 선택 근거

- Cloudflare 무료 플랜으로 권한 DNS를 운영할 수 있어 초기 비용이 낮다.
- EC2, 다른 클라우드와 온프레미스 등 호스팅 위치와 관계없이 DNS Record를 연결할 수 있다.
- AWS 교육 계정이 종료되더라도 도메인 소유권과 DNS 계정을 유지할 수 있다.
- DNS 사업자를 AWS와 분리하여 클라우드 이전 시 Record 대상만 변경할 수 있다.
- Nginx와 Let's Encrypt의 HTTP-01 검증 구성을 그대로 사용할 수 있다.
- 초기에는 Proxy 기능을 끄고 DNS만 사용하여 요청 경로와 TLS 문제를 단순하게 유지할 수 있다.
- 프론트와 API를 같은 도메인의 경로로 제공하면 CORS와 인증 Cookie 구성이 단순해진다.

### 운영 및 이식성 원칙

- 도메인은 개인 임시 이메일이 아니라 장기간 접근 가능한 팀 또는 소유자 계정으로 등록한다.
- 자동 갱신, 결제 수단, 복구 이메일과 2단계 인증을 설정하고 담당자를 문서화한다.
- 첫해 할인 가격뿐 아니라 매년 적용되는 갱신 가격을 확인한다.
- Cloudflare에서 받은 Nameserver를 도메인 등록기관에 설정한다.
- EC2의 변경 가능한 일반 Public IP가 아닌 고정 Public IP를 DNS A Record 대상으로 사용한다.
- 초기에는 Cloudflare Record를 DNS-only로 설정하여 요청이 EC2 Nginx로 직접 전달되게 한다.
- TTL은 초기 변경 기간에는 짧게 두고 주소가 안정되면 늘린다.
- DNS Record와 용도를 문서화하고 가능하면 향후 선택할 IaC로 관리한다.
- API는 별도 Subdomain보다 동일 서비스 도메인의 `/api` 경로를 우선 사용한다.
- DNS 변경 전 기존 Record를 내보내거나 기록하여 다른 DNS 사업자로 이전할 수 있게 한다.

### 감수할 단점

- AWS 계정 외에 Cloudflare 계정과 접근 권한을 추가로 관리해야 한다.
- 도메인 등록과 갱신 비용은 별도로 발생하며 AWS 교육 크레딧과 분리될 수 있다.
- Cloudflare DNS 장애나 계정 문제의 영향을 받을 수 있다.
- Cloudflare DNS 설정 방식과 API에 일정 부분 종속된다.
- 고정 Public IPv4 사용에 따른 AWS 비용이 발생할 수 있다.
- 단일 EC2를 가리키므로 DNS만으로 EC2 장애를 해결할 수 없다.

### Cloudflare Proxy를 사용하지 않는 이유

초기에는 Cloudflare의 CDN·Reverse Proxy 기능을 사용하지 않고 DNS 응답만 제공하도록 한다. 이미 Nginx가 Reverse Proxy와 HTTPS를 담당하므로 Cloudflare Proxy까지 사용하면 TLS 구간, Cache, 실제 사용자 IP Header와 장애 분석 범위가 늘어난다.

다음 요구가 생기면 Cloudflare Proxy 사용을 별도로 검토한다.

- 정적 콘텐츠 CDN이 필요할 때
- 원본 EC2 IP를 외부에 직접 노출하지 않아야 할 때
- DDoS 완화나 웹 보안 기능이 필요할 때
- 실제 사용자 IP와 Proxy 신뢰 설정을 안전하게 구성할 수 있을 때

### 재검토 조건

- 회사가 지정한 도메인과 사내 DNS를 사용해야 할 때
- 완전한 폐쇄망에서 내부 도메인만 제공해야 할 때
- Cloudflare Proxy, CDN 또는 웹 보안 기능이 필요할 때
- ALB나 CloudFront 도입으로 DNS 대상과 TLS 종료 위치가 변경될 때
- Cloudflare 비용, 정책 또는 계정 종속성이 문제가 될 때
- Route 53의 AWS 자원 자동 연동과 Health check가 운영상 더 중요해질 때

### 문서용 결론

> 공개 서비스용 도메인을 구매하고 Cloudflare DNS 무료 플랜을 DNS-only 모드로 사용한다. 도메인 소유권과 갱신은 6개월짜리 AWS 교육 계정과 분리된 장기 유지 계정에서 관리한다. DNS A Record는 EC2의 고정 Public IP를 가리키고, 프론트와 API는 같은 서비스 도메인에서 `/api` 경로로 구분한다. 초기에는 Cloudflare Proxy를 사용하지 않고 Nginx와 Let's Encrypt가 Reverse Proxy와 HTTPS를 담당한다. CDN이나 웹 보안 기능이 필요해지면 Cloudflare Proxy 사용을 재검토한다.

## 21. 인프라 코드

### 선택지 정보

- **Terraform**: HCL과 다양한 Provider를 사용하는 선언형 IaC 도구다.
- **OpenTofu**: Terraform 계열의 오픈소스 IaC 도구다.
- **AWS CDK**: 프로그래밍 언어로 AWS 자원을 정의해 CloudFormation으로 적용한다.
- **수동 구성 + 재현 문서**: 자원이 적은 초기 단계에 사용할 수 있지만 반복성과 검토 가능성이 낮다.

| 항목 | Terraform | OpenTofu | AWS CDK | 수동 구성 |
|---|---|---|---|---|
| 작성 방식 | HCL | HCL 계열 | 프로그래밍 언어 | 콘솔·명령 |
| 멀티 클라우드 | 지원 | 지원 | AWS 중심 | 절차에 따라 다름 |
| 상태 관리 | 필요 | 필요 | CloudFormation 중심 | 없음 |
| 재현성·리뷰 | 높음 | 높음 | 높음 | 문서 품질에 좌우 |
| 종속성 | 중간 | 중간 | 높음 | 콘솔에 종속될 수 있음 |

**선택 결과: 미정**
