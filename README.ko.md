# codex-meter (한국어)

오픈소스 메인테이너를 위한 "지출을 인지하는" Codex 자동화 도구. 정책 게이트, 월 예산 강제, 감사 원장(ledger), PR별 지출 리포트를 제공한다.

## 왜 필요한가

Codex 리뷰는 유용하지만 비싸다. 23줄짜리 diff 리뷰 한 번이 실측 **입력 116,593 / 출력 4,642 토큰**(`gpt-5.4` 기준 약 $0.13)이었다. Codex for OSS 그랜트든 API 크레딧이든 Pro 요금제든 한도는 소진되고, 대부분의 리뷰 봇은 그 속도를 알려주지 않는다.

`codex-meter`는 Codex CLI 앞에 서서 네 가지를 해결한다.

1. **이 PR에 토큰을 써야 하나?**: draft, 라벨, fork PR, 문서만 변경, lockfile·생성물만 변경, 너무 큰 diff, 이미 리뷰한 커밋을 싼 순서로 먼저 걸러낸다.
2. **얼마까지 쓸 수 있나?**: 월 토큰·달러 예산과 실행당 상한을 호출 *전에* 강제한다.
3. **실제로 얼마 썼나?**: Codex가 보고한 실제 `turn.completed` 사용량을 파싱해 가격표로 계산하고 append-only 원장에 기록한다.
4. **이번 달에 어디로 나갔나?**: `codex-meter report`가 PR별 지출, 스킵 사유, 캐시 재사용률, 심각도별 발견 수를 보여준다.

## 빠른 시작 (GitHub Actions)

```yaml
name: codex-meter
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: write        # 원장 브랜치를 쓸 때만 필요
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: twoimo/codex-meter@v1
        with:
          api-key: ${{ secrets.OPENAI_API_KEY }}
          budget-tokens: '1200000'
          state: branch
```

## 빠른 시작 (CLI)

```bash
npx @twoimo/codex-meter explain --base origin/main    # 판단만, 지출 없음
npx @twoimo/codex-meter review  --base origin/main    # 리뷰 + 계측 + 코멘트
npx @twoimo/codex-meter report  --month 2026-09       # 월 지출 요약
```

`explain`은 Codex를 호출하지 않고 결정·사유·예상 토큰·남은 예산만 출력하므로 정책을 조정할 때 안전하다.

## 안전 모델

- API 키는 임시 `CODEX_HOME`에서 `codex login --with-api-key`로 한 번 저장하고, Codex 프로세스 환경에서는 제거한다. 따라서 체크아웃된 코드에서 실행되는 명령이 키를 읽을 수 없다.
- fork PR은 기본적으로 건너뛴다.
- Codex는 `--ephemeral`(세션 파일 없음)과 CLI 기본 read-only 샌드박스로 실행된다. 이 도구는 저장소를 수정하거나 커밋을 푸시하지 않는다.
- 예산 소진 시 PR을 실패시키지 않고, 사유를 코멘트로 남기고 리뷰를 멈춘다.

전체 옵션과 정책 표는 [README.md](README.md)와 [docs/](docs/)를 참고.

## 개발

```bash
npm ci
npm test          # 빌드 + 56개 테스트 (기록된 세션 리플레이 포함)
```

통합 테스트는 `test/fixtures/`의 캡처된 Codex 세션을 재생하므로 네트워크·자격증명·쿼터가 필요 없다.

## 라이선스

MIT
