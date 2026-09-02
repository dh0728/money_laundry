# AML AWS 수동 인프라 구축 플랜

최종 수정일: 2026-08-25  
대상 리전: `ap-northeast-2` (서울)  
구축 방식: AWS Management Console 수동 구성

## 1. 목적

이 문서는 AML 서비스의 초기 AWS 인프라를 수동으로 구축하고 검증하기 위한 실행 계획이다. 단일 EC2와 Docker Compose를 중심으로 시작하며, 외부 공개 지점은 Nginx의 HTTP 80과 HTTPS 443으로 제한한다.

초기 구축 범위는 다음과 같다.

- VPC와 인터넷 연결
- 퍼블릭 서브넷과 Route Table
- 웹 트래픽 전용 Security Group
- 장기 거래 원문 Archive용 S3 Bucket
- 거래 수집용 SQS Standard Queue와 DLQ
- EC2에서 사용할 IAM Role

## 2. 구축 원칙

- 모든 작업 전 AWS Console의 리전이 `ap-northeast-2`인지 확인한다.
- SSH 22를 공개하지 않고 EC2 운영에는 Systems Manager Session Manager와 Run Command를 사용한다.
- PostgreSQL 5432, Spring 8080, React 개발 서버 3000은 외부에 공개하지 않는다.
- S3, SQS와 Parameter Store에는 EC2 IAM Role을 통해 접근하고 장기 Access Key를 서버에 저장하지 않는다.
- S3 Bucket과 SQS Queue는 공개하지 않는다.
- 실제 비밀번호, JWT Secret과 API Key는 Git, Docker 이미지와 일반 문서에 기록하지 않는다.
- 자원 생성 직후 이름, ID, ARN과 설정값을 이 문서의 구축 결과표에 기록한다.

## 3. 전체 구축 순서

```text
AWS 계정·리전 확인
  → VPC
  → Internet Gateway
  → Public Subnet
  → Public Route Table·Route·Subnet Association
  → Security Group
  → S3 Archive Bucket
  → SQS DLQ
  → SQS Main Queue·Redrive Policy
  → EC2 IAM Role
  → EC2·Elastic IP
  → Docker Compose·Nginx·애플리케이션 배포
  → Cloudflare DNS·HTTPS 검증
  → Security Group을 Cloudflare IP 전용으로 제한
  → 로그·알람·백업 검증
```

## 4. 현재 진행 상태

| 단계 | 자원 | 상태 | 확인 사항 |
|---|---|---|---|
| 1 | `aml-vpc` | 완료 | IPv4 CIDR `10.0.0.0/16` |
| 2 | `aml-igw` | 완료 | `aml-vpc`에 연결 |
| 3 | `aml-public-2a` | 완료 | `ap-northeast-2a`, `10.0.1.0/24` |
| 4 | `aml-public-rt` | 생성 완료·검증 필요 | 기본 경로와 Subnet Association 확인 |
| 5 | `aml-web-sg` | 초기 구성 완료 | 80/443만 공개, Cloudflare 전환은 추후 수행 |
| 6 | S3 Archive Bucket | 예정 | 이름은 전 세계에서 고유해야 함 |
| 7 | SQS Main Queue·DLQ | 예정 | DLQ를 먼저 생성 |
| 8 | EC2 IAM Role | 예정 | SSM과 자원별 최소 권한 적용 |

## 5. 네트워크 최종 검증

S3 구축 전에 다음 항목을 확인한다.

### 5.1 Public Route 확인

`VPC → Route tables → aml-public-rt → Routes`에서 다음 경로가 있어야 한다.

| Destination | Target |
|---|---|
| `10.0.0.0/16` | local |
| `0.0.0.0/0` | `aml-igw` |

`0.0.0.0/0 → aml-igw`가 없다면 `Edit routes`에서 추가한다.

### 5.2 Subnet Association 확인

`aml-public-rt → Subnet associations`에서 `aml-public-2a`가 명시적으로 연결되어 있어야 한다.

Route Table을 생성만 하고 서브넷에 연결하지 않으면 `aml-public-2a`에 적용되지 않는다.

### 5.3 Security Group 확인

초기 Inbound Rule은 다음 두 개만 둔다.

| Type | Protocol | Port | Source | 용도 |
|---|---|---:|---|---|
| HTTP | TCP | 80 | `0.0.0.0/0` | 인증서 발급·HTTP Redirect·초기 검증 |
| HTTPS | TCP | 443 | `0.0.0.0/0` | 서비스 접속·초기 검증 |

다음 Inbound Rule은 생성하지 않는다.

- SSH 22
- React 개발 서버 3000
- PostgreSQL 5432
- Spring Boot 8080
- IPv6 `::/0`

IPv6를 사용하지 않으면 VPC, Subnet과 EC2에 IPv6를 할당하지 않고 IPv6 Security Group Rule도 만들지 않는다.

## 6. S3 Archive Bucket 생성

### 6.1 목적

S3는 실시간 거래 처리 경로가 아니라 장기 거래 원문 Archive 저장소로 사용한다. 오래된 원문 이벤트를 시간 또는 건수 단위의 JSONL/Parquet 파일로 묶어 업로드한다.

S3는 VPC나 Subnet에 배치하는 자원이 아니다. 서울 리전에 생성하고 EC2 IAM Role로 접근한다.

### 6.2 이름 규칙

S3 Bucket 이름은 전 세계 AWS 계정에서 고유해야 한다.

권장 형식:

```text
aml-prod-archive-<AWS_ACCOUNT_ID>
```

예시:

```text
aml-prod-archive-123456789012
```

### 6.3 Console 생성값

`S3 → General purpose buckets → Create bucket`

| 설정 | 값 |
|---|---|
| AWS Region | `ap-northeast-2` |
| Bucket type | General purpose |
| Bucket name | `aml-prod-archive-<AWS_ACCOUNT_ID>` |
| Object Ownership | Bucket owner enforced |
| ACL | Disabled |
| Block Public Access | 네 항목 모두 활성화 |
| Bucket Versioning | Enabled 권장 |
| Default encryption | SSE-S3 |
| Object Lock | 초기에는 Disabled |

권장 태그:

| Key | Value |
|---|---|
| `Project` | `aml` |
| `Environment` | `prod` |
| `Purpose` | `transaction-archive` |

### 6.4 운영 규칙

- Bucket과 Object를 공개하지 않는다.
- 정적 웹 사이트 호스팅을 활성화하지 않는다.
- 거래 한 건마다 작은 Object를 생성하지 않는다.
- 권장 Object Key 구조는 `archive/year=YYYY/month=MM/day=DD/...` 형식이다.
- Archive 파일에 기간, 레코드 수, Schema Version과 Checksum을 기록한다.
- 업로드 건수와 Checksum 검증이 끝난 뒤에만 DB 원문을 정리한다.
- 보존 기간이 합의되기 전에는 자동 삭제 Lifecycle Rule을 만들지 않는다.
- Versioning을 켜면 이전 버전도 저장 비용이 발생하므로 향후 Noncurrent Version 정책을 별도로 결정한다.

### 6.5 완료 조건

- [ ] Bucket이 `ap-northeast-2`에 생성됨
- [ ] Block Public Access 네 항목이 모두 활성화됨
- [ ] ACL이 비활성화됨
- [ ] 기본 암호화가 활성화됨
- [ ] Versioning 설정을 확인함
- [ ] Bucket 이름과 ARN을 구축 결과표에 기록함

## 7. SQS와 DLQ 생성

### 7.1 구성 목적

Spring Boot API가 거래 이벤트를 Main Queue에 발행하고, Ingestion Worker가 Long Polling으로 수신해 PostgreSQL에 저장한다. 반복 실패한 메시지는 DLQ로 격리한다.

생성 순서는 다음과 같다.

```text
DLQ 생성
  → Main Queue 생성
  → Main Queue의 Dead-letter queue로 DLQ 지정
  → DLQ의 Redrive Allow Policy를 Main Queue로 제한
```

### 7.2 DLQ 생성

`SQS → Create queue`

| 설정 | 값 |
|---|---|
| Type | Standard |
| Name | `aml-transaction-events-dlq` |
| Message retention period | 14 days |
| Encryption | SQS-managed server-side encryption |
| Access policy | Basic·Queue owner only |

DLQ는 자동 재시도 Queue가 아니라 최종 실패 메시지를 분석하고 수동 재처리하기 위한 격리 공간이다.

### 7.3 Main Queue 생성

| 설정 | 값 |
|---|---|
| Type | Standard |
| Name | `aml-transaction-events` |
| Visibility timeout | 초기값 120 seconds |
| Message retention period | 4 days |
| Receive message wait time | 20 seconds |
| Encryption | SQS-managed server-side encryption |
| Dead-letter queue | `aml-transaction-events-dlq` |
| Maximum receives | 5 |
| Access policy | Basic·Queue owner only |

Visibility Timeout은 Worker의 실제 최대 처리시간보다 길어야 한다. 처리시간이 120초를 넘으면 Timeout을 연장하거나 작업 단위를 줄인다.

### 7.4 Redrive Allow Policy

DLQ를 사용할 수 있는 Source Queue를 `aml-transaction-events`로 제한한다. 같은 계정의 모든 Queue를 허용하는 기본값보다 Source Queue를 명시하는 방식을 우선한다.

### 7.5 애플리케이션 처리 원칙

- 메시지에 `schema_version`, `event_id` 또는 `transaction_id`, `event_time`, 추적 ID를 포함한다.
- 비밀번호, JWT, API Key와 같은 Secret을 메시지에 넣지 않는다.
- SQS Standard Queue의 중복 전달과 순서 변경 가능성을 전제로 한다.
- DB에 `event_id` 또는 `transaction_id` Unique Constraint를 둔다.
- DB Commit이 성공한 이후에만 SQS 메시지를 삭제한다.
- 처리 실패 시 메시지를 삭제하지 않고 Visibility Timeout 이후 재수신한다.
- 다섯 번째 처리 한도를 넘긴 메시지는 DLQ로 이동시킨다.

### 7.6 완료 조건

- [ ] DLQ와 Main Queue가 같은 계정·리전에 생성됨
- [ ] 두 Queue가 Standard 유형임
- [ ] 두 Queue의 관리형 암호화가 활성화됨
- [ ] DLQ 보존 기간이 Main Queue보다 김
- [ ] Main Queue의 Long Polling이 20초로 설정됨
- [ ] Main Queue에 DLQ와 Maximum receives 5가 연결됨
- [ ] DLQ가 Main Queue만 Source로 허용함
- [ ] Queue URL과 ARN을 구축 결과표에 기록함

## 8. EC2 IAM Role 생성

### 8.1 목적

EC2가 장기 Access Key 없이 SSM, CloudWatch, S3, SQS와 Parameter Store에 접근하도록 Instance Role을 사용한다.

`IAM → Roles → Create role`

| 설정 | 값 |
|---|---|
| Trusted entity type | AWS service |
| Use case | EC2 |
| Role name | `aml-ec2-role` |

AWS Console에서 EC2용 Role을 만들면 EC2에 연결할 Instance Profile도 함께 준비된다.

### 8.2 AWS 관리형 정책

다음 정책을 연결한다.

| 정책 | 목적 |
|---|---|
| `AmazonSSMManagedInstanceCore` | Session Manager와 Run Command |
| `CloudWatchAgentServerPolicy` | EC2 로그와 메트릭 전송 |

### 8.3 애플리케이션 전용 최소 권한

별도의 고객 관리형 정책 또는 Inline Policy로 필요한 자원만 허용한다.

#### S3 권한

Bucket ARN과 Object ARN을 분리해 지정한다.

- Bucket: `s3:GetBucketLocation`, `s3:ListBucket`, `s3:ListBucketMultipartUploads`
- Object: `s3:GetObject`, `s3:PutObject`, `s3:AbortMultipartUpload`, `s3:ListMultipartUploadParts`
- Resource: 생성한 Archive Bucket과 그 하위 Object만 허용
- 일반 실행 권한에는 `s3:DeleteObject`를 부여하지 않음

#### SQS 권한

Main Queue인 `aml-transaction-events`에만 다음 권한을 허용한다.

- `sqs:SendMessage`
- `sqs:SendMessageBatch`
- `sqs:ReceiveMessage`
- `sqs:DeleteMessage`
- `sqs:DeleteMessageBatch`
- `sqs:ChangeMessageVisibility`
- `sqs:ChangeMessageVisibilityBatch`
- `sqs:GetQueueAttributes`
- `sqs:GetQueueUrl`

EC2 애플리케이션에는 초기부터 DLQ 삭제·Purge 권한을 부여하지 않는다.

#### Parameter Store 권한

운영 Parameter 경로만 읽도록 제한한다.

```text
/aml/prod/*
```

허용 작업:

- `ssm:GetParameter`
- `ssm:GetParameters`
- `ssm:GetParametersByPath`

고객 관리형 KMS Key로 SecureString이나 S3를 암호화하는 경우 해당 Key에 대한 제한된 KMS 권한을 별도로 추가한다.

### 8.4 완료 조건

- [ ] Trust relationship이 EC2 서비스만 허용함
- [ ] `AmazonSSMManagedInstanceCore`가 연결됨
- [ ] CloudWatch Agent 정책이 연결됨
- [ ] S3 권한이 Archive Bucket으로 제한됨
- [ ] SQS 권한이 Main Queue로 제한됨
- [ ] Parameter Store 권한이 `/aml/prod/*`로 제한됨
- [ ] Access Key를 생성하지 않음
- [ ] Role 이름과 ARN을 구축 결과표에 기록함

## 9. 자원 연동 검증

EC2 생성 후 다음 순서로 검증한다.

### 9.1 SSM 접속

- EC2에 `aml-ec2-role`을 연결한다.
- SSM Agent 상태와 Outbound HTTPS 통신을 확인한다.
- SSH 22를 열지 않은 상태에서 Session Manager 접속을 확인한다.

### 9.2 S3 검증

- EC2 Role로 테스트 파일을 Archive Bucket에 업로드한다.
- 업로드한 Object의 Server-side encryption을 확인한다.
- 인증되지 않은 공개 URL 접근이 거부되는지 확인한다.
- 테스트 Object 정리는 별도의 관리자 권한으로 수행한다.

### 9.3 SQS 검증

- EC2 Role로 Main Queue에 테스트 메시지를 발행한다.
- Worker 또는 AWS Console에서 메시지를 수신한다.
- 정상 처리 시 DB Commit 이후 메시지가 삭제되는지 확인한다.
- 테스트 환경에서 반복 실패를 발생시켜 메시지가 DLQ로 이동하는지 확인한다.
- DLQ 메시지를 분석한 뒤 수동 Redrive 절차를 검증한다.

## 10. EC2 이후 후속 단계

현재 네트워크·저장소·Queue·IAM 구축 후 다음 작업을 진행한다.

1. Ubuntu LTS EC2 생성
2. Subnet에 `aml-public-2a` 지정
3. Security Group에 `aml-web-sg` 지정
4. IAM Role에 `aml-ec2-role` 지정
5. Elastic IP 할당·연결
6. SSM Session Manager 접속 확인
7. Docker와 Docker Compose 설치
8. Nginx, React, Spring Boot, Worker와 PostgreSQL 컨테이너 배포
9. PostgreSQL 데이터 경로를 EC2 영구 Volume에 연결
10. Cloudflare DNS A Record를 Elastic IP에 연결
11. Nginx와 인증서의 HTTP/HTTPS 동작 검증
12. Cloudflare Proxy 활성화
13. Security Group을 Cloudflare IP 전용으로 제한
14. CloudWatch 로그·SQS 적체·DLQ 유입 알람 구성
15. DB Backup과 S3 Archive 복구 테스트

## 11. Cloudflare 전환 절차

초기 검증이 끝나기 전에는 80/443을 `0.0.0.0/0`에서 허용한다. Cloudflare 전환은 다음 순서를 지킨다.

1. Cloudflare DNS A Record가 EC2 Elastic IP를 가리키는지 확인한다.
2. DNS-only 상태에서 도메인과 HTTPS를 검증한다.
3. Cloudflare Proxy를 활성화한다.
4. Proxy 상태에서 HTTP, HTTPS, `/api`와 인증서 동작을 검증한다.
5. 80/443에 Cloudflare 공식 IPv4 CIDR을 추가한다.
6. 기존 `0.0.0.0/0` 규칙을 제거한다.
7. 도메인 접속은 성공하고 Origin IP 직접 접속은 차단되는지 확인한다.
8. Cloudflare IP 대역 변경 공지를 정기적으로 확인한다.

향후 IPv6를 사용하면 Cloudflare 공식 IPv6 CIDR만 허용하고 `::/0`은 제거한다.

## 12. 구축 결과 기록표

| 자원 | 이름 | ID·ARN·URL | 리전·AZ | 완료일 | 확인자 |
|---|---|---|---|---|---|
| VPC | `aml-vpc` |  | `ap-northeast-2` |  |  |
| Internet Gateway | `aml-igw` |  | `ap-northeast-2` |  |  |
| Public Subnet | `aml-public-2a` |  | `ap-northeast-2a` |  |  |
| Public Route Table | `aml-public-rt` |  | `ap-northeast-2` |  |  |
| Security Group | `aml-web-sg` |  | `ap-northeast-2` |  |  |
| S3 Archive Bucket | `aml-prod-archive-<ACCOUNT_ID>` |  | `ap-northeast-2` |  |  |
| SQS Main Queue | `aml-transaction-events` |  | `ap-northeast-2` |  |  |
| SQS DLQ | `aml-transaction-events-dlq` |  | `ap-northeast-2` |  |  |
| EC2 IAM Role | `aml-ec2-role` |  | Global |  |  |

## 13. 최종 점검표

- [ ] 모든 리전 자원이 `ap-northeast-2`에 있음
- [ ] `aml-public-2a`가 `aml-public-rt`에 연결됨
- [ ] `0.0.0.0/0` 경로가 `aml-igw`를 가리킴
- [ ] 공개 Inbound Port가 80/443뿐임
- [ ] SSH, PostgreSQL, Spring과 React 개발 Port가 공개되지 않음
- [ ] S3 Public Access가 전부 차단됨
- [ ] SQS Main Queue와 DLQ가 암호화됨
- [ ] DLQ 보존 기간이 Main Queue보다 김
- [ ] EC2 Role 권한이 Resource 단위로 제한됨
- [ ] Access Key와 Secret이 서버·Git·문서에 없음
- [ ] SSM, S3, SQS와 DLQ 검증이 완료됨
- [ ] Cloudflare 전환 후 Origin 직접 접근이 차단됨
- [ ] 운영 알람과 백업·복구 절차가 문서화됨

## 14. 참고 문서

- [Amazon S3 General Purpose Bucket 생성](https://docs.aws.amazon.com/AmazonS3/latest/userguide/create-bucket-overview.html)
- [Amazon S3 Block Public Access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html)
- [Amazon SQS Dead-letter Queue](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)
- [EC2용 IAM Role](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/iam-roles-for-amazon-ec2.html)
- [Systems Manager Instance 권한](https://docs.aws.amazon.com/systems-manager/latest/userguide/setup-instance-permissions.html)
- [Cloudflare IP 주소](https://developers.cloudflare.com/fundamentals/concepts/cloudflare-ip-addresses/)
