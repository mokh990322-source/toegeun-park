# 퇴근파크 (TOEGEUN PARK)

NAU 모델링팀 2~8인 온라인 협동 게임. 피코파크처럼 옆에서 보는 플랫폼이고,
전원이 출입구에 모여야 판이 끝난다 — 한 명이라도 못 나오면 아무도 퇴근 못 한다.

**사람이 모자라면 대기실에서 AI 동료를 넣으면 된다.** 혼자서도 3판을 다 깰 수 있다.

## 주소

https://mokh990322-source.github.io/toegeun-park/

방을 만들면 네 글자 코드가 나온다. **초대 링크 복사**를 눌러 메신저에 붙여 넣으면
받은 사람은 그대로 눌러서 들어온다(`.../toegeun-park/#ABCD`).
고친 뒤에는 `깃허브업데이트.bat` 하나로 올라간다.

- 설계: `docs/superpowers/specs/2026-09-02-toegeun-park-design.md`
- 1단계 계획: `docs/superpowers/plans/2026-09-02-toegeun-park-phase1.md`

## 조작

←→ / A D 로 이동, Space / ↑ / W 로 점프. 그게 전부다.

## 테스트

    node --test

봇이 판 3개를 실제 물리로 끝까지 깨는지까지 여기서 확인한다 — 브라우저가 필요 없다.

## 로컬 실행

    python -m http.server 8895 --directory .

브라우저에서 http://localhost:8895 를 연다. 두 사람 이상으로 해 보려면 창을 여러 개
열고 같은 방 코드로 들어가면 된다.
