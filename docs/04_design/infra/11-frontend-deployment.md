# 프론트엔드 배포 기본 개념

[인프라 결정 기록으로 돌아가기](README.md)

## 프론트엔드란?

프론트엔드는 사용자의 브라우저에서 보이는 화면과 상호작용을 담당한다. HTML은 문서 구조, CSS는 표현, JavaScript는 동작을 주로 담당한다.

## 렌더링 방식

- **정적 사이트**: 미리 생성한 HTML, CSS와 JavaScript 파일을 그대로 제공한다.
- **SPA(Single Page Application)**: 최초에 정적 파일을 받고 이후 JavaScript가 화면 전환과 API 통신을 처리한다.
- **CSR(Client-Side Rendering)**: 브라우저가 JavaScript를 실행해 화면을 만든다.
- **SSR(Server-Side Rendering)**: 요청할 때 서버가 HTML을 생성한다.
- **SSG(Static Site Generation)**: 빌드할 때 페이지별 HTML을 미리 생성한다.

배포 방식은 프레임워크 이름만으로 정하지 않고 빌드 결과가 정적 파일인지, 요청마다 실행되는 서버가 필요한지 먼저 확인해야 한다.

## 기본 용어

- **Build output**: 프론트엔드 빌드가 생성한 배포 파일
- **Static hosting**: 서버 실행 없이 정적 파일을 전달하는 방식
- **CDN**: 여러 지역의 캐시 서버에서 파일을 전달하는 네트워크
- **Cache invalidation**: CDN이나 브라우저가 가진 이전 파일 캐시를 갱신하는 작업
- **Client-side routing**: 브라우저가 URL에 따라 화면을 전환하는 방식
- **Preview deployment**: 변경 사항을 병합하기 전에 별도 주소에서 확인하는 환경

SPA의 경로로 직접 접속했을 때 정적 서버가 해당 파일을 찾지 못할 수 있다. 이 경우 애플리케이션 진입 HTML로 연결하는 fallback 설정이 필요하다.

## 주요 프론트엔드 배포 서비스와 구성

### Nginx 컨테이너

프론트엔드 빌드 결과를 Nginx 이미지 안에 복사하거나 Volume으로 연결해 정적 파일 웹 서버로 제공하는 구성이다. Docker Compose에서는 프론트 제공용 컨테이너를 다른 서비스와 함께 정의할 수 있다.

### Amazon S3 정적 파일 저장

S3 Bucket에 HTML, CSS, JavaScript와 이미지 파일을 객체로 업로드하는 방식이다. S3의 정적 웹 사이트 기능을 사용하거나 CloudFront가 비공개 Bucket의 파일을 읽도록 구성할 수 있다.

### Amazon CloudFront

CloudFront는 원본 서버나 S3의 콘텐츠를 여러 지역의 Edge Location에 캐시해 전달하는 AWS CDN이다. Domain, TLS 인증서, Cache Policy와 원본 접근 권한을 배포 단위로 설정한다.

### Vercel

Vercel은 Git 저장소와 연결해 프론트엔드 프로젝트를 빌드하고 배포하는 관리형 플랫폼이다. 정적 파일, CDN, 서버 측 실행 기능과 변경 브랜치별 Preview URL을 제공한다.
