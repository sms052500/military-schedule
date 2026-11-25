-- ===================================================
-- [개인 및 부대 일정관리 & 공개 메모장] Supabase 설정 SQL
-- ===================================================
-- 복사해서 Supabase 대시보드의 [SQL Editor]에 붙여넣고 [Run] 버튼을 누르세요!

-- 1. 기존 테이블이 있다면 정리 (선택사항, 초기화용)
-- drop table if exists public.memos;
-- drop table if exists public.schedules;

-- 2. 공개 메모장(memos) 테이블 생성
create table if not exists public.memos (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  author text not null,
  category text default '응원',
  content text not null,
  emoji text default '💬',
  password text,
  color text default 'yellow'
);

-- 3. 부대 및 개인 일정(schedules) 테이블 생성
create table if not exists public.schedules (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  title text not null,
  type text not null default 'unit', -- 'unit'(부대), 'personal'(개인), 'vacation'(휴가), 'duty'(당직/근무)
  start_date date not null,
  end_date date,
  location text,
  memo text,
  priority text default 'normal'     -- 'urgent'(긴급), 'important'(중요), 'normal'(보통)
);

-- 4. Row Level Security (RLS - 보안 정책) 활성화
alter table public.memos enable row level security;
alter table public.schedules enable row level security;

-- 5. 공개 접근 정책 설정 (누구나 로그인 없이 읽기/쓰기 가능하도록 허용)
-- (1) memos 읽기 허용
create policy "누구나 메모를 볼 수 있습니다"
  on public.memos for select
  using (true);

-- (2) memos 추가 허용
create policy "누구나 메모를 작성할 수 있습니다"
  on public.memos for insert
  with check (true);

-- (3) memos 삭제 허용
create policy "누구나 메모를 삭제할 수 있습니다"
  on public.memos for delete
  using (true);

-- (4) schedules 읽기 허용
create policy "누구나 일정을 볼 수 있습니다"
  on public.schedules for select
  using (true);

-- (5) schedules 추가 허용
create policy "누구나 일정을 등록할 수 있습니다"
  on public.schedules for insert
  with check (true);

-- (6) schedules 수정 및 삭제 허용
create policy "누구나 일정을 관리할 수 있습니다"
  on public.schedules for all
  using (true);

-- 6. 초기 샘플 데이터 입력 (테이블 생성 후 바로 예쁘게 보이도록)
insert into public.schedules (title, type, start_date, end_date, location, memo, priority)
values 
  ('대대 전술훈련평가', 'unit', current_date + interval '3 day', current_date + interval '5 day', '대연병장 및 훈련장', '단독군장 준비 및 장비 점검 완료할 것', 'urgent'),
  ('정기 외박 / 휴가', 'vacation', current_date + interval '10 day', current_date + interval '13 day', '서울 본가', '복귀시간 20:00 준수', 'important'),
  ('주간 야간 당직근무', 'duty', current_date + interval '1 day', current_date + interval '1 day', '지휘통통실', '근무교대 15분 전 도착', 'normal'),
  ('부대 체육대회 및 풋살', 'unit', current_date + interval '7 day', current_date + interval '7 day', '연병장', '중대 대항 토너먼트', 'normal');

insert into public.memos (author, category, content, emoji, color)
values
  ('3소대 김병장', '응원', '오늘 하루도 다치지 말고 무사히 훈련 마칩시다! 충성!', '💪', 'yellow'),
  ('민성이 친구 현우', '응원', '민성아 휴가 때 보자! 맛있는 거 사줄게 힘내라!', '🍕', 'blue'),
  ('행정보급관', '부대안내', '금일 일과 후 생활관 방역 및 개인 관물대 정리정돈 철저히 바람.', '📢', 'green'),
  ('방문자', '자유', '사이트 디자인 깔끔하고 보기 좋네요. 국군 장병 여러분 파이팅입니다!', '⭐', 'purple');

