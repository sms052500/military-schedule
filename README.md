# 🎖️ 개인 및 부대 일정관리 체계 & 대민 공개 메모장

> 누구나 접속하여 응원과 메모를 남길 수 있는 **공개 메모장**과 **개인/부대 일정 관리(D-Day & 캘린더)**를 제공하는 풀스택 웹 애플리케이션입니다.  
> **Supabase(DB)** + **GitHub(소스 제어)** + **Vercel(클라우드 배포)** 3단계로 누구나 10분 만에 실제 웹사이트(URL)를 운영할 수 있습니다.

---

## 📁 프로젝트 파일 구성

- `index.html`: 메인 웹페이지 (헤더, D-Day 위젯, 미니 캘린더, 일정 리스트, 공개 메모장 폼 & 포스트잇 보드, 설정 모달)
- `style.css`: 세련된 밀리터리 & 테크 다크 테마 스타일시트 (모바일 & PC 반응형)
- `app.js`: 데이터 처리 및 Supabase 실시간 연동 로직 (미연동 시 로컬 데모 모드 자동 지원)
- `config.js`: Supabase Project URL 및 Anon Key 설정 파일
- `supabase-setup.sql`: Supabase 데이터베이스 테이블 및 공개 보안 정책 자동 생성 SQL 스크립트
- `vercel.json`: Vercel 배포 최적화 설정

---

## 🚀 1단계: Supabase에서 데이터베이스 만들기 (SQL 몰라도 1분 컷)

1. **[supabase.com](https://supabase.com)**에 로그인합니다.
2. 초록색 **[New Project]** (새 프로젝트) 버튼을 클릭합니다.
   - **Name**: `military-schedule` (원하는 이름 아무거나)
   - **Database Password**: 기억하기 쉬운 비밀번호 입력 (또는 Generate Password)
   - **Region**: `Northeast (Seoul)` 선택 (가장 빠릅니다!)
   - **[Create new project]** 클릭 후 약 1~2분 대기합니다.
3. 프로젝트가 생성되면 왼쪽 사이드바 메뉴에서 **[SQL Editor]** 아이콘(`>_` 모양)을 클릭합니다.
4. 상단 **[+ Create query]** 또는 빈 편집창에 프로젝트 폴더의 **`supabase-setup.sql` 파일 내용 전체**를 복사해서 붙여넣습니다.
5. 우측 하단의 초록색 **[Run]** (또는 `Ctrl + Enter`) 버튼을 클릭합니다!
   - `Success. No rows returned` 메시지가 나오면 **테이블 생성 및 누구나 작성할 수 있는 보안 정책 설정이 100% 완료**된 것입니다.

---

## 🔑 2단계: Supabase 접속 키(URL, Key) 복사 및 연동하기

1. Supabase 왼쪽 메뉴 맨 아래의 **[Project Settings]** (⚙️ 톱니바퀴 아이콘)을 클릭합니다.
2. 왼쪽 서브메뉴에서 **[Data API]** (또는 **[API]**)를 클릭합니다.
3. 화면에 나오는 다음 두 가지 값을 확인합니다:
   - **Project URL**: `https://xxxxxxxxxxxx.supabase.co` 형태의 주소
   - **Project API Keys**: `anon` / `public` 태그가 붙어있는 긴 문자열 키
4. 연동하는 방법 (둘 중 편한 방식 하나 선택):
   - **방법 A (가장 추천)**: 컴퓨터에서 `index.html`을 더블클릭해서 브라우저로 연 다음, 상단 우측의 **[⚙️ 로컬 데모 모드 (연결 설정)]** 버튼을 누르고 URL과 Key를 붙여넣은 뒤 **[연동 테스트 및 저장]** 클릭!
   - **방법 B**: 코드 에디터에서 `config.js` 파일을 열고, 따옴표 안에 복사한 URL과 Key를 직접 적어두기.

---

## 🐙 3단계: GitHub에 소스코드 올리기 (초보자용 웹 업로드)

Git 명령어를 전혀 몰라도 웹 브라우저에서 마우스 드래그만으로 올릴 수 있습니다!

1. **[github.com](https://github.com)**에 로그인합니다.
2. 우측 상단의 **[+]** 아이콘을 누르고 **[New repository]**를 클릭합니다.
3. 설정 입력:
   - **Repository name**: `military-schedule-memo` (원하는 이름)
   - **Public** 선택 (누구나 접속해야 하므로 공개 권한)
   - 하단의 체크박스들은 모두 비워둔 채 **[Create repository]** 클릭!
4. 생성된 페이지 화면 중간쯤에 있는 파란색 글씨 **`uploading an existing file`** 링크를 클릭합니다.
5. 현재 폴더(`히히` 폴더) 안에 있는 모든 파일들을 마우스로 드래그하여 브라우저 네모 박스 안에 끌어다 놓습니다:
   - `index.html`
   - `style.css`
   - `app.js`
   - `config.js`
   - `supabase-setup.sql`
   - `vercel.json`
   - `README.md`
6. 하단의 초록색 **[Commit changes]** 버튼을 누르면 GitHub 업로드 완료!

---

## ⚡ 4단계: Vercel과 GitHub 연동하여 나만의 URL 만들기

1. **[vercel.com](https://vercel.com)**에 접속하여 GitHub 계정으로 로그인합니다 (**Continue with GitHub**).
2. 대시보드 우측 상단의 **[Add New...]** -> **[Project]**를 클릭합니다.
3. 목록에서 방금 깃허브에 올린 `military-schedule-memo` 저장소 옆의 **[Import]** 버튼을 클릭합니다.
4. 프로젝트 설정 화면이 나오면 아무것도 건드릴 필요 없이 맨 아래 파란색 **[Deploy]** 버튼을 클릭합니다!
5. 약 20초 정도 기다리면 폭죽이 터지며 **"Congratulations!"** 화면이 나타납니다.
6. 화면에 보이는 미리보기 창이나 **도메인 주소(예: `military-schedule-memo.vercel.app`)**를 클릭하면 전 세계 누구나 접속할 수 있는 실제 웹사이트가 열립니다!

---

## ✨ 주요 기능 안내

1. **🎖️ D-Day & 국방부 시계**:
   - 입대일과 전역일을 기준으로 남은 일수와 복무 달성률(%)을 실시간 프로그레스 바로 시각화
   - 다음 휴가 및 부대 주요 훈련 D-Day 카운트 (상단 슬라이더 아이콘으로 언제든 변경 가능)
2. **📅 부대 & 개인 일정 캘린더**:
   - 🛡️ 부대 훈련/검열, 👤 개인 일정, 🏖️ 휴가/외출, ⏰ 당직/근무 분류 필터
   - 미니 캘린더에서 날짜 클릭 시 해당 일자의 일정만 쏙쏙 모아보기
3. **💌 대민 공개 메모장 & 응원 보드**:
   - 접속하는 누구나 로그인 없이 닉네임, 응원 메시지, 이모지, 포스트잇 색상을 선택해 작성 가능
   - Supabase DB에 실시간 저장되어 사이트에 접속한 모든 사람에게 즉시 공유
   - 작성 시 비밀번호를 설정하면 본인만 메모를 삭제할 수 있는 보호 기능 탑재
