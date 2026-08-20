# 컨테이너 이미지 저장소 기본 개념

[인프라 결정 기록으로 돌아가기](README.md)

## 이미지 저장소란?

컨테이너 이미지 저장소(Container Registry)는 CI나 개발자가 만든 이미지를 보관하고 서버가 필요한 버전을 내려받게 하는 서비스다.

```mermaid
flowchart LR
    CI[CI 빌드] -->|push| Registry[이미지 저장소]
    Registry -->|pull| Server[운영 서버]
    Server --> Container[컨테이너 실행]
```

## 기본 용어

- **Repository**: 같은 애플리케이션의 이미지들을 모아 두는 공간
- **Push**: 로컬이나 CI에서 이미지를 저장소로 올리는 작업
- **Pull**: 저장소의 이미지를 실행 환경으로 내려받는 작업
- **Tag**: `v1.2.0`, 커밋 ID처럼 이미지 버전을 구분하는 이름
- **Digest**: 이미지 내용으로 계산되는 변경 불가능한 식별값
- **Private registry**: 인증받은 사용자만 접근할 수 있는 비공개 저장소
- **Retention policy**: 오래되거나 사용하지 않는 이미지를 정리하는 규칙
- **Vulnerability scanning**: 이미지에 포함된 패키지의 알려진 취약점을 검사하는 기능

태그는 사람이 읽기 쉽지만 같은 태그를 다른 이미지에 다시 붙일 수 있다. 정확히 같은 이미지를 재배포해야 한다면 고유 버전 태그나 digest를 사용한다.

레지스트리는 애플리케이션 데이터 저장소가 아니다. 실행할 소프트웨어 패키지를 배포하는 장소이며 데이터베이스 백업이나 사용자 파일은 별도 저장소에서 관리한다.

## 주요 이미지 저장소 서비스

### Amazon ECR

ECR(Elastic Container Registry)은 AWS가 운영하는 컨테이너 이미지 저장소다. Registry 인증과 Repository 접근 권한을 AWS IAM으로 관리하며 AWS의 컨테이너 실행 서비스나 EC2에서 이미지를 내려받을 수 있다.

### Docker Hub

Docker Hub는 Docker가 운영하는 컨테이너 이미지 저장소 서비스다. 공개 이미지와 비공개 Repository를 제공하며 Docker CLI로 로그인해 이미지를 Push하거나 Pull한다. 널리 사용하는 오픈소스 소프트웨어의 공식 이미지도 배포된다.

### GitHub Container Registry

GHCR(GitHub Container Registry)은 GitHub Packages의 컨테이너 이미지 저장소다. 이미지 이름은 보통 `ghcr.io/소유자/이미지` 형태이며 GitHub 계정, 조직, 토큰과 Repository 권한을 이용해 접근을 관리한다.
