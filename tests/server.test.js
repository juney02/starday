// 별하루 서버(GAS) 통합 테스트: 가짜 시트/시계/X API로 파이프라인 전체를 검증한다
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const SRC = path.join(__dirname, '..', 'src');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; } else { fails++; console.log('FAIL:', m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (기대 ${JSON.stringify(b)}, 실제 ${JSON.stringify(a)})`);

const { makeEnv } = require('./harness.js');
const j = s => JSON.stringify(s);
const TOKEN = 'secret-admin-token-123';

// ============================================================ 1. 별자리 이름 변환
{
  const e = makeEnv();
  const cases = { aries: ['おひつじ座', 'オヒツジ座', '牡羊座'], taurus: ['おうし座', '牡牛座'], gemini: ['ふたご座', '双子座'], cancer: ['かに座', '蟹座'], leo: ['しし座', '獅子座'], virgo: ['おとめ座', '乙女座'],
    libra: ['てんびん座', '天秤座'], scorpio: ['さそり座', '蠍座'], sagittarius: ['いて座', '射手座'], capricorn: ['やぎ座', '山羊座'], aquarius: ['みずがめ座', '水瓶座'], pisces: ['うお座', '魚座'] };
  let allOk = true;
  Object.keys(cases).forEach(k => cases[k].forEach(n => { if (e.call(`zodiacKeyFromName_(${j(n)})`) !== k) { allOk = false; console.log('  변환 실패', n); } }));
  ok(allOk, '일본어 별자리 12종(히라가나·가타카나·한자) → 영문 식별자');
  eq(e.call(`findSignInText_('３位　牡羊座')`).key, 'aries', '줄 안에서 별자리 찾기');
  ok(e.call(`findSignInText_('今日は晴れです')`) === null, '별자리 없는 문장은 null');
}

// ============================================================ 2. 분석기 / 검증
{
  const e = makeEnv();
  const posts = e.call(`TestFeed.getPosts('2026-10-15','normal')`);
  const text = posts.filter(p => p.author_id === 'TEST_AUTHOR' && !p.is_retweet && /位/.test(p.text)).map(p => p.text).join('\n');
  const parsed = e.call(`parseHoroscopeText_(${j(text)}, '2026-10-15')`);
  eq(parsed.items.length, 12, '분석: 12개 별자리');
  eq(parsed.date, '2026-10-15', '분석: 날짜');
  eq(parsed.items.map(i => i.rank).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], '분석: 순위 1~12');
  ok(parsed.items.every(i => i.content_ja && i.lucky_item_ja && i.lucky_color_ja), '분석: 설명·행운 아이템·색상 추출');
  const v = e.call(`validateHoroscope_(${j(parsed.items.map(i => ({ sign: i.sign, rank: i.rank, content_ja: i.content_ja })))}, {expectedDate:'2026-10-15', parsedDate:'2026-10-15', authorOk:true})`);
  eq(v.status, 'VALID', '검증: 정상 데이터');
  const items = parsed.items.map(i => ({ sign: i.sign, rank: i.rank, content_ja: i.content_ja }));
  const dup = items.map((x, i) => (i === 3 ? { ...x, rank: items[2].rank } : x));
  ok(e.call(`validateHoroscope_(${j(dup)}, {expectedDate:'2026-10-15', parsedDate:'2026-10-15', authorOk:true})`).errors.some(m => /순위 중복/.test(m)), '검증: 순위 중복 탐지');
  const dupSign = items.map((x, i) => (i === 3 ? { ...x, sign: items[2].sign } : x));
  ok(e.call(`validateHoroscope_(${j(dupSign)}, {expectedDate:'2026-10-15', parsedDate:'2026-10-15', authorOk:true})`).errors.some(m => /별자리 중복/.test(m)), '검증: 별자리 중복 탐지');
  eq(e.call(`validateHoroscope_(${j(items.slice(1))}, {expectedDate:'2026-10-15', parsedDate:'2026-10-15', authorOk:true})`).status, 'INVALID', '검증: 별자리 누락 → INVALID');
  ok(e.call(`validateHoroscope_(${j(items)}, {expectedDate:'2026-10-15', parsedDate:'2026-10-14', authorOk:true})`).errors.some(m => /운세 날짜/.test(m)), '검증: 날짜 불일치');
  ok(e.call(`validateHoroscope_(${j(items)}, {expectedDate:'2026-10-15', parsedDate:'2026-10-15', authorOk:false})`).errors.some(m => /대상 계정/.test(m)), '검증: 작성자가 대상 계정이 아니면 실패');
  eq(e.call(`validateHoroscope_(${j(items)}, {expectedDate:'2026-10-15', parsedDate:'2026-10-15', authorOk:true, fromImage:true})`).status, 'NEEDS_REVIEW', '검증: 이미지 분석 결과는 검토 필요');
  // 순위가 한 줄 위에 따로 적힌 형식, 전각 숫자
  const alt = e.call(`parseHoroscopeText_('【１位】\\nしし座\\n文章A\\nラッキーアイテム：本\\n【2位】\\nうお座\\n文章B', '2026-10-15')`);
  eq(alt.items.map(i => [i.sign, i.rank]), [['leo', 1], ['pisces', 2]], '분석: 순위 줄 분리·전각 숫자 형식');
  eq(e.call(`parseHoroscopeText_('12月31日の占い\\n1位 しし座', '2027-01-01')`).date, '2026-12-31', '분석: 연말 날짜 연도 보정');
}

// ============================================================ 3. TEST 모드 파이프라인 + 슬롯
{
  const e = makeEnv();
  e.run(`setupSheets()`);
  e.setNow('2026-10-15 07:59');
  e.run('tick()');
  eq(e.call(`Db.readAll('import_logs').length`), 0, '07:59에는 실행 안 함');
  e.setNow('2026-10-15 08:00');
  e.run('tick()');
  let rows = e.call(`HoroscopeRepo.rowsForDate('2026-10-15','TEST')`);
  eq(rows.length, 12, '08:00 슬롯: 12행 저장');
  ok(rows.every(r => r.publication_status === 'REVIEW' && r.validation_status === 'VALID' && r.translation_status === 'DONE'), '기본(AUTO_PUBLISH 꺼짐): 검증·번역 완료, 승인 대기(REVIEW)');
  ok(rows.every(r => r.data_mode === 'TEST' && /\[TEST\]/.test(r.source_name)), '테스트 데이터는 [TEST] 출처·TEST 모드로 구분');
  ok(rows.every(r => r.source_post_id && r.source_published_at), '출처 게시물 ID·게시 시각 저장');
  ok(rows.every(r => r.content_ko.indexOf('테스트용') === 0 && r.content_ja.indexOf('テスト用') === 0), '일본어 원문과 한국어 번역을 함께 저장');
  const posts = e.call(`Db.readAll('source_posts')`);
  ok(posts.length === 3 && posts.every(p => p.classification === 'HOROSCOPE'), '출처 메타데이터: 오늘 운세 게시물 3건만 기록(리포스트·타 계정·무관한 글 제외)');
  const logs = () => e.call(`Db.readAll('import_logs')`);
  eq(logs().length, 1, '로그 1건'); eq(logs()[0].import_status, 'REVIEW', '로그 상태 REVIEW'); eq(logs()[0].records_found, 12, '로그: 발견 12건');

  // 공개 전: 사용자에게는 가상 운세(TEST_FALLBACK)가 나오고, 저장된 데이터는 아직 안 보인다
  let pub = e.call(`getHoroscopes()`);
  eq(pub.status, 'MOCK', '승인 전: 공개되지 않음(가상 폴백)');
  ok(pub.version.indexOf('MOCKGEN') === 0, '승인 전: 저장된 데이터가 아니라 즉석 가상 데이터');

  // 08:03 → 같은 슬롯 재실행 없음 / 08:10 → 데이터가 이미 완전해서 SKIPPED
  e.setNow('2026-10-15 08:03'); e.run('tick()'); eq(logs().length, 1, '같은 슬롯은 중복 실행 안 함');
  e.setNow('2026-10-15 08:10'); e.run('tick()');
  eq(logs().length, 2, '08:10 슬롯 실행'); eq(logs()[1].import_status, 'SKIPPED', '이미 검증된 데이터가 있으면 재저장하지 않음(SKIPPED)');
  eq(e.call(`HoroscopeRepo.rowsForDate('2026-10-15','TEST').length`), 12, '중복 저장 없음(12행 유지)');

  // 관리자 승인 → 즉시 사용자에게 반영(캐시 무효화)
  e.run(`Settings.set('ADMIN_TOKEN', ${j(TOKEN)})`);
  pub = e.call(`getHoroscopes()`); // 캐시에 가상 폴백이 들어간 상태
  const res = e.call(`adminSetPublication(${j(TOKEN)}, '2026-10-15', 'publish', false)`);
  ok(res.every(r => r.publication_status === 'PUBLISHED'), '관리자 승인: 12행 PUBLISHED');
  pub = e.call(`getHoroscopes()`);
  ok(pub.version.indexOf('MOCK|') === 0 || pub.version.indexOf('MOCK|2026') === 0, '승인 직후 캐시 없이 최신 데이터 반영');
  eq(pub.items.length, 12, '공개 데이터 12건'); eq(pub.items.map(i => i.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], '순위 오름차순');
  ok(pub.isMock === true && pub.items[0].content_ko && pub.items[0].source_name.indexOf('[TEST]') === 0, '테스트 데이터는 isMock=true, 출처 [TEST]');
  ok(!('validation_note' in pub.items[0]) && !('id' in pub.items[0]), '사용자 응답에 내부 필드 없음');

  // 비공개 처리
  e.call(`adminSetPublication(${j(TOKEN)}, '2026-10-15', 'unpublish')`);
  eq(e.call(`getHoroscopes()`).version.indexOf('MOCKGEN'), 0, '비공개 처리하면 공개 데이터에서 빠짐');
  e.call(`adminSetPublication(${j(TOKEN)}, '2026-10-15', 'publish', false)`);

  // 공개된 행은 강제 재확인으로도 덮어쓰지 않는다
  const before = j(e.call(`HoroscopeRepo.rowsForDate('2026-10-15','TEST')`).map(r => [r.zodiac_sign, r.rank, r.updated_at]));
  e.setNow('2026-10-15 08:30');
  const r2 = e.call(`Importer.run('MANUAL', {force:true})`);
  eq(e.call(`HoroscopeRepo.rowsForDate('2026-10-15','TEST').length`), 12, '강제 재확인 후에도 12행(중복 없음)');
  eq(j(e.call(`HoroscopeRepo.rowsForDate('2026-10-15','TEST')`).map(r => [r.zodiac_sign, r.rank, r.updated_at])), before, '공개된 데이터는 자동 수집이 덮어쓰지 않음');
}

// ============================================================ 4. AUTO_PUBLISH + 다음 날
{
  const e = makeEnv();
  e.run(`Settings.set('AUTO_PUBLISH','true')`);
  e.setNow('2026-10-16 08:00'); e.run('tick()');
  const rows = e.call(`HoroscopeRepo.rowsForDate('2026-10-16','TEST')`);
  ok(rows.length === 12 && rows.every(r => r.publication_status === 'PUBLISHED'), 'AUTO_PUBLISH: 검증 통과 시 자동 공개');
  eq(e.call(`getHoroscopes()`).status, 'MOCK', '자동 공개 후 사용자에게 저장 데이터 표시');
  ok(e.call(`getHoroscopes()`).version.indexOf('MOCK|2026-10-16') === 0, '저장된 데이터의 버전(updated_at) 포함');
}

// ============================================================ 5. 실패 시나리오
function scenario(name, check) {
  const e = makeEnv();
  e.run(`Settings.set('TEST_SCENARIO','${name}'); Settings.set('AUTO_PUBLISH','true'); Settings.set('TEST_FALLBACK','false')`);
  e.setNow('2026-10-15 08:00'); e.run('tick()');
  check(e);
}
scenario('none', e => {
  const l = e.call(`Db.readAll('import_logs')`);
  eq(l[0].import_status, 'NO_POST', '게시물 없음 → NO_POST');
  eq(e.call(`HoroscopeRepo.rowsForDate('2026-10-15','TEST').length`), 0, '게시물 없으면 운세를 만들어 내지 않음');
  const early = e.call(`getHoroscopes()`);
  eq(early.status, 'PENDING', '사용자: PENDING'); ok(/확인하고 있어요/.test(early.message), '9시 전 안내 문구');
  e.setNow('2026-10-15 09:00'); e.run('tick()');
  eq(e.call(`Db.readAll('import_logs').length`), 2, '08:10·08:30·09:00 슬롯이 한꺼번에 도래해도 확인은 1회만 실행');
  e.setNow('2026-10-15 09:05');
  const late = e.call(`getHoroscopes()`);
  eq(late.message, '오늘의 오하아사 운세가 아직 업데이트되지 않았어요. 공식 게시물을 확인한 뒤 반영됩니다.', '9시 이후 안내 문구(사양과 동일)');
  e.setNow('2026-10-15 10:00'); e.run('tick()');
  eq(e.call(`Db.readAll('import_logs').length`), 2, '9시 최종 확인 이후에는 자동 확인을 더 하지 않음');
});
scenario('duplicate_rank', e => {
  const rows = e.call(`HoroscopeRepo.rowsForDate('2026-10-15','TEST')`);
  ok(rows.length === 12 && rows.every(r => r.validation_status === 'INVALID' && r.publication_status === 'REVIEW'), '순위 중복 → 검증 실패, 자동 공개되지 않고 검수 대기');
  ok(/순위 중복/.test(rows[0].validation_note), '검증 사유 기록');
  eq(e.call(`getHoroscopes()`).status, 'PENDING', '사용자에게 공개되지 않음');
  eq(e.call(`Db.readAll('import_logs')[0].valid_records`), 0, '로그: 유효 0건');
  eq(rows[0].translation_status, 'NONE', '검증 실패 데이터는 번역하지 않음');
  const thrown = (() => { try { e.call(`adminSetPublication(${j('x')}, '2026-10-15', 'publish')`); } catch (er) { return er.message; } })();
  ok(/NOT_CONFIGURED|DENIED/.test(thrown || ''), '인증 없이 공개 불가');
  e.run(`Settings.set('ADMIN_TOKEN', ${j(TOKEN)})`);
  const msg = (() => { try { e.call(`adminSetPublication(${j(TOKEN)}, '2026-10-15', 'publish', true)`); } catch (er) { return er.message; } })();
  ok(/갖춰져야|검증에 실패/.test(msg || ''), '관리자도 INVALID는 공개 불가');
  // 관리자가 중복 순위를 고치면 공개할 수 있다
  const bad = e.call(`adminRows(${j(TOKEN)}, '2026-10-15')`);
  const ranks = {}; bad.forEach(r => { (ranks[r.rank] = ranks[r.rank] || []).push(r); });
  const dupRank = Object.keys(ranks).find(k => ranks[k].length > 1);
  const missing = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].find(n => !ranks[n]);
  e.call(`adminSaveRow(${j(TOKEN)}, ${j(ranks[dupRank][1].id)}, {rank: ${missing}}, false)`);
  const fixed = e.call(`adminRows(${j(TOKEN)}, '2026-10-15')`);
  eq(fixed[0].validation_status, 'VALID', '관리자 수정 후 재검증 통과');
  const noTr = (() => { try { e.call(`adminSetPublication(${j(TOKEN)}, '2026-10-15', 'publish', false)`); } catch (er) { return er.message; } })();
  ok(/번역이 완료/.test(noTr || ''), '번역이 끝나지 않으면 공개 불가(설정에 따라)');
  const tr = e.call(`adminTranslate(${j(TOKEN)}, '2026-10-15')`);
  ok(tr.rows.every(r => r.translation_status === 'DONE' && r.content_ko), '관리자 번역 실행: 한국어 번역 채워짐');
  e.call(`adminSetPublication(${j(TOKEN)}, '2026-10-15', 'publish', false)`);
  eq(e.call(`getHoroscopes().items.length`), 12, '수정·번역·승인 후 공개');
  // 수정한 행은 자동 수집이 덮어쓰지 않는다 (공개 취소 후 강제 재확인)
  e.call(`adminSetPublication(${j(TOKEN)}, '2026-10-15', 'unpublish')`);
  e.setNow('2026-10-15 08:20'); e.run(`Importer.run('MANUAL',{force:true})`);
  const after = e.call(`adminRows(${j(TOKEN)}, '2026-10-15')`);
  ok(after.find(r => r.id === ranks[dupRank][1].id).rank === missing, '관리자가 수정한 행은 재수집이 덮어쓰지 않음');
});
scenario('missing_sign', e => {
  const rows = e.call(`HoroscopeRepo.rowsForDate('2026-10-15','TEST')`);
  eq(rows.length, 11, '누락된 별자리는 임의로 만들지 않음(11건)');
  ok(rows.every(r => r.validation_status === 'INVALID') && /누락된 별자리/.test(rows[0].validation_note), '누락 탐지');
  eq(e.call(`getHoroscopes().status`), 'PENDING', '12개가 안 되면 전체 랭킹을 게시하지 않음');
});
scenario('wrong_date', e => {
  const rows = e.call(`HoroscopeRepo.rowsForDate('2026-10-15','TEST')`);
  ok(rows.every(r => r.validation_status === 'INVALID') && /운세 날짜\(2026-10-14\)/.test(rows[0].validation_note), '어제 날짜 운세 → 오늘 것으로 인정하지 않음');
  eq(e.call(`getHoroscopes().status`), 'PENDING', '공개 안 됨');
  e.run(`Settings.set('ADMIN_TOKEN', ${j(TOKEN)})`);
  const r = e.call(`adminRows(${j(TOKEN)}, '2026-10-15')`);
  e.call(`adminSaveRow(${j(TOKEN)}, ${j(r[0].id)}, {content_ko:'x'}, false)`);
  ok(e.call(`adminRows(${j(TOKEN)}, '2026-10-15')`)[0].validation_status === 'INVALID', '관리자가 날짜를 직접 확인했다고 하기 전에는 날짜 오류가 풀리지 않음');
  e.call(`adminSaveRow(${j(TOKEN)}, ${j(r[0].id)}, {content_ko:'x'}, true)`);
  ok(e.call(`adminRows(${j(TOKEN)}, '2026-10-15')`)[0].validation_status !== 'INVALID', '날짜 확인 체크 후에는 통과');
});
scenario('image_only', e => {
  eq(e.call(`Db.readAll('import_logs')[0].import_status`), 'IMAGE_ONLY', '이미지 게시물: 분석 권한이 없으면 수동 입력 대기');
  eq(e.call(`HoroscopeRepo.rowsForDate('2026-10-15','TEST').length`), 0, '이미지 내용은 추측해서 저장하지 않음');
  eq(e.call(`Db.readAll('source_posts').length`), 1, '이미지 게시물 메타데이터는 기록');
  e.run(`Settings.set('ADMIN_TOKEN', ${j(TOKEN)})`);
  const rows = e.call(`adminInitManual(${j(TOKEN)}, '2026-10-15')`);
  ok(rows.length === 12 && rows.every(r => r.validation_status === 'INVALID' && r.publication_status === 'REVIEW'), '수동 입력 모드: 12개 빈 행 생성(검증 전까지 비공개)');
});

// ============================================================ 6. 관리자 인증
{
  const e = makeEnv();
  const t = (fn) => { try { fn(); return ''; } catch (er) { return er.message; } };
  ok(/NOT_CONFIGURED/.test(t(() => e.call(`adminOverview('anything')`))), '인증 미설정 시 관리자 기능 꺼짐');
  e.run(`Settings.set('ADMIN_TOKEN', ${j(TOKEN)})`);
  ok(/LOGIN/.test(t(() => e.call(`adminOverview('')`))), '토큰 없이 호출 불가');
  ok(/DENIED/.test(t(() => e.call(`adminOverview('wrong')`))), '틀린 토큰 불가');
  eq(t(() => e.call(`adminOverview(${j(TOKEN)})`)), '', '올바른 토큰 통과');
  for (let i = 0; i < 10; i++) t(() => e.call(`adminOverview('bad${i}')`));
  ok(/LOCKED/.test(t(() => e.call(`adminOverview(${j(TOKEN)})`))), '10번 실패하면 잠금');
  const e2 = makeEnv();
  e2.run(`Settings.set('ADMIN_EMAILS','Admin@Example.com')`);
  e2.user.act = 'admin@example.com';
  eq(t(() => e2.call(`adminOverview('')`)), '', '허용된 이메일 계정은 토큰 없이 통과');
  e2.user.act = 'stranger@example.com';
  ok(t(() => e2.call(`adminOverview('')`)) !== '', '다른 계정은 거부');
  const ov = makeEnv(); ov.run(`Settings.set('ADMIN_TOKEN', ${j(TOKEN)}); Settings.set('X_BEARER_TOKEN','SUPERSECRET'); Settings.set('ANTHROPIC_API_KEY','KEY2')`);
  const o = ov.call(`adminOverview(${j(TOKEN)})`);
  ok(JSON.stringify(o).indexOf('SUPERSECRET') < 0 && JSON.stringify(o).indexOf('KEY2') < 0 && JSON.stringify(o).indexOf(TOKEN) < 0, '관리자 응답에도 비밀 값은 없음');
  eq(o.secrets, { xToken: true, anthropic: true, gemini: false }, '비밀은 설정 여부(true/false)만 표시');
  // 소유자 전용 함수
  const e3 = makeEnv(); e3.user.act = 'visitor@x.com';
  ok(/소유자/.test(t(() => e3.run('installTriggers()'))), '방문자는 트리거 설치 불가');
  ok(/소유자/.test(t(() => e3.run('setupSheets()'))), '방문자는 시트 초기화 불가');
  e3.user.act = 'owner@x.com'; e3.run('installTriggers()');
  eq(e3.env_triggers = e3.triggers.length, 1, '소유자는 트리거 설치(5분 간격 1개)');
  e3.run('installTriggers()'); eq(e3.triggers.length, 1, '트리거 중복 생성 안 함');
  eq(e3.triggers[0].n, 5, '5분 간격');
}

// ============================================================ 7. PRODUCTION 모드 (가짜 X API)
function xFeed(e, date, scenario) {
  const posts = e.call(`TestFeed.getPosts(${j(date)}, ${j(scenario || 'normal')})`);
  const tweets = posts.filter(p => !p.is_retweet).map(p => ({ id: p.id.replace('TEST', '1'), text: p.text, created_at: p.created_at, author_id: p.author_id === 'TEST_AUTHOR' ? '777' : '999' }));
  e.fetchHandler = (url, opt) => {
    if (/api\.x\.com\/2\/users\/by\/username\/Hi_Ohaasa/.test(url)) return { code: 200, body: { data: { id: '777', username: 'Hi_Ohaasa' } } };
    if (/api\.x\.com\/2\/users\/777\/tweets/.test(url)) return { code: 200, body: { data: tweets.slice().reverse() } };
    if (/api\.anthropic\.com/.test(url)) {
      const req = JSON.parse(opt.payload); const src = JSON.parse(req.messages[0].content).items;
      const dict = e.call('TestFeed.translations()');
      return { code: 200, body: { content: [{ type: 'text', text: '```json\n' + JSON.stringify({ items: src.map(s => ({ sign: s.sign, content: dict[s.content] || '번역', lucky_item: dict[s.lucky_item] || '', lucky_color: dict[s.lucky_color] || '' })) }) + '\n```' }] } };
    }
    return { code: 404, body: '{}' };
  };
  return e.fetchHandler;
}
{
  // 7-1. 토큰 없음 → 실패하고 기존 데이터 유지
  let e = makeEnv();
  e.run(`Settings.set('MODE','PRODUCTION'); Settings.set('PROD_SOURCE','X')`);
  e.run(`Db.append('daily_horoscopes', {id:'keep', horoscope_date:'2026-10-14', zodiac_sign:'leo', rank:1, data_mode:'PRODUCTION', publication_status:'PUBLISHED'})`);
  e.setNow('2026-10-15 08:00'); e.run('tick()');
  let log = e.call(`Db.readAll('import_logs')[0]`);
  eq(log.import_status, 'FAILED', 'X 토큰 없음 → FAILED'); ok(/AUTH/.test(log.error_message), '오류 사유 기록(AUTH)');
  eq(e.call(`Db.readAll('daily_horoscopes').length`), 1, '오류가 나도 기존 데이터 유지');
  ok(e.call(`Source.get().last_checked_at`) !== '', '마지막 확인 시각 저장');
  eq(e.call(`Source.get().last_success_at`), '', '성공 시각은 갱신 안 됨');
  const pub = e.call(`getHoroscopes()`);
  eq(pub.status, 'PENDING', '운영 모드: 데이터 없으면 PENDING(가상 데이터로 대체하지 않음)'); eq(pub.isMock, false, '운영 모드에서는 가상 데이터 표시 안 함');

  // 7-2. 토큰 있음 + 이용 허락 없음 → 링크만
  e = makeEnv(); xFeed(e, '2026-10-15');
  e.run(`Settings.set('MODE','PRODUCTION'); Settings.set('PROD_SOURCE','X'); Settings.set('X_BEARER_TOKEN','tok')`);
  e.setNow('2026-10-15 08:00'); e.run('tick()');
  log = e.call(`Db.readAll('import_logs')[0]`);
  eq(log.import_status, 'LINK_ONLY', '이용 허락 없음 → LINK_ONLY');
  eq(e.call(`Db.readAll('daily_horoscopes').length`), 0, '이용 허락 없으면 게시물 내용을 저장하지 않음');
  ok(e.call(`Db.readAll('source_posts').length`) === 3, '게시물 ID·링크·게시일 메타데이터만 저장');
  const lo = e.call(`getHoroscopes()`);
  eq(lo.status, 'LINK_ONLY', '사용자: 링크만 제공'); ok(/x\.com\/Hi_Ohaasa\/status\//.test(lo.official.url) && lo.items.length === 0, '공식 게시물 링크 제공·내용 없음');
  ok(e.fetchLog.every(u => /api\.x\.com/.test(u)), '공식 API 외 다른 주소는 호출하지 않음');
  ok(e.fetchLog.every(u => !/anthropic/.test(u)), '이용 허락 전에는 번역 API도 호출하지 않음');
  eq(e.call(`Source.get().x_user_id`), '777', '계정 ID 캐시');

  // 7-3. APPROVED + 번역 키 없음 → 검수 대기, 번역 안 함
  e.run(`Source.patch({authorization_status:'APPROVED'})`);
  e.setNow('2026-10-15 08:10'); e.run('tick()');
  let rows = e.call(`HoroscopeRepo.rowsForDate('2026-10-15','PRODUCTION')`);
  ok(rows.length === 12 && rows.every(r => r.validation_status === 'VALID' && r.translation_status === 'DONE' && r.content_ko.indexOf('[번역]') === 0 && r.publication_status === 'REVIEW'), 'APPROVED: 12건 저장, Claude 키 없음 → 내장 번역(DONE), 승인 대기');
  ok(rows.every(r => r.source_name === 'X @Hi_Ohaasa' && /^1\d+$/.test(r.source_post_id) && /x\.com\/Hi_Ohaasa\/status\/1/.test(r.source_post_url)), '출처 계정·게시물 ID·URL 저장');
  eq(e.call(`getHoroscopes().status`), 'PENDING', '승인 전에는 공개 안 됨');

  // 7-4. 번역 키 + 자동 공개
  e = makeEnv(); xFeed(e, '2026-10-15');
  e.run(`Settings.set('MODE','PRODUCTION'); Settings.set('PROD_SOURCE','X'); Settings.set('X_BEARER_TOKEN','tok'); Settings.set('ANTHROPIC_API_KEY','k'); Settings.set('AUTO_PUBLISH','true')`);
  e.run(`Source.patch({authorization_status:'APPROVED'})`);
  e.setNow('2026-10-15 08:00'); e.run('tick()');
  rows = e.call(`HoroscopeRepo.rowsForDate('2026-10-15','PRODUCTION')`);
  ok(rows.length === 12 && rows.every(r => r.publication_status === 'PUBLISHED' && r.translation_status === 'DONE' && r.content_ko), 'APPROVED+번역+AUTO_PUBLISH: 자동 공개');
  const live = e.call(`getHoroscopes()`);
  eq(live.status, 'PUBLISHED', '사용자: PUBLISHED'); eq(live.isMock, false, '운영 데이터는 isMock=false');
  ok(live.official && live.official.url, '공식 게시물 링크 포함');
  const callsBefore = e.fetchLog.length;
  e.setNow('2026-10-15 08:10'); e.run('tick()');
  eq(e.call(`HoroscopeRepo.rowsForDate('2026-10-15','PRODUCTION').length`), 12, '재확인해도 중복 저장 없음');
  ok(e.call(`Db.readAll('import_logs')[1].import_status`) === 'SKIPPED', '유효 데이터가 있으면 SKIPPED');
  ok(e.call(`Db.readAll('source_posts').length`) === 3, '출처 메타데이터 중복 기록 없음');
  // 허락 상태가 취소되면 공개도 막힌다
  e.run(`Source.patch({authorization_status:'LINK_ONLY'}); HoroscopeRepo.invalidate('2026-10-15')`);
  eq(e.call(`getHoroscopes().status`), 'LINK_ONLY', '이용 허락이 취소되면 즉시 링크만 제공');
  eq(e.call(`getHoroscopes().items.length`), 0, '허락 취소 시 내용 비공개');

  // 7-5. API 오류 처리
  const errCase = (code, headers, expectCode, expectSleeps) => {
    const x = makeEnv(); x.run(`Settings.set('MODE','PRODUCTION'); Settings.set('PROD_SOURCE','X'); Settings.set('X_BEARER_TOKEN','tok')`);
    x.fetchHandler = () => ({ code, body: '{}', headers });
    x.setNow('2026-10-15 08:00'); x.run('tick()');
    const l = x.call(`Db.readAll('import_logs')[0]`);
    ok(l.import_status === 'FAILED' && l.error_message.indexOf(expectCode) >= 0, `HTTP ${code} → ${expectCode} 로 기록`);
    eq(x.sleeps, expectSleeps, `HTTP ${code}: 재시도 대기 횟수`);
    eq(x.fetchLog.length, expectSleeps + 1, `HTTP ${code}: 호출 횟수(무한 반복 없음)`);
  };
  errCase(401, {}, 'AUTH', 0); errCase(403, {}, 'FORBIDDEN', 0); errCase(429, { 'x-rate-limit-reset': '1' }, 'RATE_LIMIT', 0); errCase(503, {}, 'SERVER', 2);
  // 네트워크 예외
  const n = makeEnv(); n.run(`Settings.set('MODE','PRODUCTION'); Settings.set('PROD_SOURCE','X'); Settings.set('X_BEARER_TOKEN','tok')`);
  n.ctx.UrlFetchApp.fetch = () => { throw new Error('timeout'); };
  n.setNow('2026-10-15 08:00'); n.run('tick()');
  ok(/NETWORK/.test(n.call(`Db.readAll('import_logs')[0].error_message`)) && n.sleeps === 2, '네트워크 장애: 2번만 재시도 후 실패 기록');
}

// ============================================================ 8. 달력 / 보관기간 / 자동 갱신 토글
{
  const e = makeEnv();
  e.run(`Settings.set('AUTO_PUBLISH','true'); Settings.set('RETENTION_DAYS','30')`);
  e.setNow('2026-10-15 08:00'); e.run('tick()');
  eq(e.call(`getHoroscopes('2026-12-25').status`), 'FUTURE', '미래 날짜는 운세 없음');
  eq(e.call(`getHoroscopes('2026-08-01').status`), 'EXPIRED', '보관 기간이 지난 날짜');
  const a = e.call(`getAvailableDates('2026-10')`);
  ok(a.dates.indexOf('2026-10-15') >= 0 && a.dates.indexOf('2026-10-16') < 0 && a.dates.indexOf('2026-09-01') < 0, '달력: 오늘까지, 보관 기간 안의 날짜만');
  e.run(`Settings.set('TEST_FALLBACK','false')`);
  eq(e.call(`getAvailableDates('2026-10')`).dates, ['2026-10-15'], '달력: 저장·공개된 날짜만 표시');
  eq(e.call(`getHoroscopes('2026-10-10').status`), 'NODATA', '기록 없는 과거 날짜 → NODATA');
  // 보관 정리
  e.run(`Db.append('daily_horoscopes', {id:'old', horoscope_date:'2026-01-01', zodiac_sign:'leo', rank:1, data_mode:'TEST'})`);
  eq(e.call(`Importer.purgeOld_()`), 1, '보관 기간 지난 행 정리'); eq(e.call(`Db.readAll('daily_horoscopes').length`), 12, '최근 데이터는 유지');
  e.run(`Settings.set('RETENTION_DAYS','0')`); eq(e.call(`getHoroscopes('2026-08-01').status`), 'NODATA', '보관 기간 0 = 제한 없음');
  // 자동 갱신 끄기
  const d = makeEnv(); d.run(`Settings.set('ADMIN_TOKEN', ${j(TOKEN)})`);
  d.call(`adminSetSettings(${j(TOKEN)}, {enabled:false})`);
  d.setNow('2026-10-16 08:00'); d.run('tick()');
  eq(d.call(`Db.readAll('import_logs').length`), 0, '자동 갱신을 끄면 tick이 아무것도 안 함');
  const bad = (() => { try { d.call(`adminSetSettings(${j(TOKEN)}, {MODE:'HACK'})`); } catch (er) { return er.message; } })();
  ok(/모드 값/.test(bad || ''), '설정 값 검증');
  const run = d.call(`adminSetSettings(${j(TOKEN)}, {enabled:true})`); ok(run.source.enabled === true, '자동 갱신 다시 켜기');
  d.call(`adminRunImport(${j(TOKEN)})`);
  ok(d.call(`Db.readAll('import_logs').length`) === 1 && d.call(`Db.readAll('import_logs')[0].trigger`) === 'MANUAL', '"지금 데이터 확인" 수동 실행 기록');
}


// ============================================================ 9. 공식 사이트(horoscope.json) 수집
{
  const SAMPLE = (date, opt = {}) => [{
    horoscope_id: '3020', onair_date: date, open_st: '2',
    detail: Array.from({ length: 12 }, (_, k) => {
      const i = k + 1, no = ((i * 5) % 12) + 1;
      let lucky = i === 2 ? '茶色' : (i === 3 ? 'ＧＯＯＤラック' : '自転車');
      let text = `テスト文${i}A\tテスト文${i}B\t\t\t${lucky}`;
      if (i === 4) text = 'テスト文4A\tテスト文4B\tテスト文4C';           // 행운 항목이 없는 경우
      return { horoscope_detail_id: String(100 + i), horoscope_id: '3020', ranking_no: String(i), horoscope_st: ('0' + no).slice(-2), horoscope_text: text };
    }).filter((_, idx) => !(opt.drop && idx === opt.drop)),
  }];
  const URL_RE = /ohaasa2020\/horoscope\.json/;
  const site = (e, json, code = 200) => { e.fetchHandler = (url) => (URL_RE.test(url) ? { code, body: json } : { code: 404, body: '{}' }); };

  // 9-1. 분석기
  let e = makeEnv();
  const p = e.call(`parseOhaasaJson_(${j(SAMPLE('20261015'))})`);
  eq(p.date, '2026-10-15', '공식 JSON: 방송일 → 날짜'); eq(p.items.length, 12, '공식 JSON: 12개');
  eq(new Set(p.items.map(i => i.sign)).size, 12, '공식 JSON: 별자리 12종 중복 없음');
  eq(p.items.map(i => i.rank).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], '공식 JSON: 순위 1~12');
  const by = Object.fromEntries(p.items.map(i => [i.rank, i]));
  eq(by[1].sign, 'virgo', '별자리 번호 06 → virgo');
  eq(e.call(`OHAASA_SIGN_BY_NO_[2]`), 'gemini', '번호 03 = 쌍둥이자리');
  eq(by[2].lucky_color_ja, '茶色', '색 단어는 행운 색상으로 분류'); eq(by[2].lucky_item_ja, '', '색이면 아이템은 비움');
  eq(by[1].lucky_item_ja, '自転車', '그 외는 행운 아이템'); eq(by[1].content_ja, 'テスト文1A\nテスト文1B', '설명은 줄바꿈으로 연결');
  eq(by[3].lucky_item_ja, 'GOODラック', '전각 영문 → 반각');
  ok(by[4].lucky_item_ja === '' && by[4].content_ja.split('\n').length === 3, '행운 항목이 없으면 설명 3줄을 모두 설명으로 유지');
  const bad = (j2) => { try { e.call(`parseOhaasaJson_(${j(j2)})`); } catch (er) { return er.xcode || er.message; } };
  eq(bad({}), 'FORMAT', '형식이 다르면 FORMAT 오류'); eq(bad([{ onair_date: 'x', detail: [] }]), 'FORMAT', '방송일 형식 오류');

  // 9-2. 이용 허락 전: 링크만, 내용 저장 안 함
  e = makeEnv(); site(e, SAMPLE('20261015'));
  e.run(`Settings.set('MODE','PRODUCTION')`);                                  // PROD_SOURCE 기본값 = SITE
  eq(e.call(`adminOverview`.length ? `Importer.origin_('PRODUCTION')` : ''), 'SITE', '운영 모드 기본 수집 경로는 공식 사이트');
  e.setNow('2026-10-15 08:00'); e.run('tick()');
  eq(e.call(`Db.readAll('import_logs')[0].import_status`), 'LINK_ONLY', '이용 허락 전 → LINK_ONLY');
  eq(e.call(`Db.readAll('daily_horoscopes').length`), 0, '이용 허락 전에는 내용을 저장하지 않음');
  ok(e.fetchLog.length === 1 && URL_RE.test(e.fetchLog[0]), '공식 데이터 파일 1개만 조회(1번 호출)');
  const lo = e.call(`getHoroscopes()`);
  ok(lo.status === 'LINK_ONLY' && lo.official.url === 'https://www.asahi.co.jp/ohaasa/week/horoscope/' && lo.items.length === 0, '사용자: 공식 페이지 링크만');

  // 9-3. 이용 허락 후: 저장 + Google 번역 + 자동 공개
  e.run(`Source.patch({authorization_status:'APPROVED'}); Settings.set('AUTO_PUBLISH','true')`);
  e.setNow('2026-10-15 08:10'); e.run('tick()');
  const rows = e.call(`HoroscopeRepo.rowsForDate('2026-10-15','PRODUCTION')`);
  ok(rows.length === 12 && rows.every(r => r.publication_status === 'PUBLISHED' && r.validation_status === 'VALID'), 'APPROVED: 검증 후 자동 공개');
  ok(rows.every(r => r.translation_status === 'DONE' && r.content_ko.indexOf('[번역]') === 0), '번역 키가 없으면 내장 Google 번역으로 번역');
  ok(rows.every(r => r.source_name.indexOf('公式サイト') > 0 && r.source_post_id === 'ohaasa-3020' && /asahi\.co\.jp\/ohaasa/.test(r.source_post_url)), '출처: 공식 사이트·ID·URL 저장');
  const pub = e.call(`getHoroscopes()`);
  ok(pub.status === 'PUBLISHED' && pub.isMock === false && pub.items.length === 12 && pub.items[0].rank === 1, '사용자: 실제 데이터(PUBLISHED, isMock=false), 1위부터');
  const calls = e.fetchLog.length;
  e.setNow('2026-10-15 08:30'); e.run('tick()');
  eq(e.fetchLog.length, calls, '이미 검증된 데이터가 있으면 사이트를 다시 조회하지 않음');

  // 9-4. 방송일이 오늘이 아니면(주말 등) 저장하지 않음
  e = makeEnv(); site(e, SAMPLE('20261014'));
  e.run(`Settings.set('MODE','PRODUCTION'); Source.patch({authorization_status:'APPROVED'})`);
  e.setNow('2026-10-15 08:00'); e.run('tick()');
  const nl = e.call(`Db.readAll('import_logs')[0]`);
  ok(nl.import_status === 'NO_POST' && /2026-10-14/.test(nl.error_message), '어제 자료면 NO_POST (이전 날짜를 오늘 것으로 쓰지 않음)');
  eq(e.call(`HoroscopeRepo.rowsForDate('2026-10-15','PRODUCTION').length`), 0, '오늘 날짜로는 저장 안 함'); eq(e.call(`getHoroscopes().status`), 'PENDING', '사용자: PENDING');
  ok(e.call(`HoroscopeRepo.rowsForDate('2026-10-14','PRODUCTION')`).length === 12, '어제 자료는 "어제 날짜의 기록"으로만 저장 (최근 3일 안)');

  // 9-4b. 3일보다 오래된 자료는 기록으로도 저장하지 않음
  e = makeEnv(); site(e, SAMPLE('20261010'));
  e.run(`Settings.set('MODE','PRODUCTION'); Source.patch({authorization_status:'APPROVED'})`);
  e.setNow('2026-10-15 08:00'); e.run('tick()');
  eq(e.call(`Db.readAll('daily_horoscopes').length`), 0, '오래된 자료는 저장하지 않음');

  // 9-4c. 처음 설정(setupRealApp): 실제 운세 모드로 한 번에 + 오늘 운세 바로 가져오기
  e = makeEnv(); site(e, SAMPLE('20261015'));
  e.setNow('2026-10-15 10:00'); e.run('setupRealApp()');
  ok(e.call(`Settings.mode()`) === 'PRODUCTION' && e.call(`Source.authorization()`) === 'APPROVED' && e.call(`Settings.get('AUTO_PUBLISH','')`) === 'true', '처음 설정: 운영 모드·APPROVED·자동 공개');
  ok(e.triggers.length === 1 && e.call(`Settings.has('ADMIN_TOKEN')`), '처음 설정: 자동 확인 트리거·관리자 토큰');
  const su = e.call(`getHoroscopes()`);
  ok(su.status === 'PUBLISHED' && su.isMock === false && su.items.length === 12, '처음 설정 직후: 실제 운세가 바로 보임(가상 데이터 아님)');
  e.user.act = 'visitor@x.com'; ok(/소유자/.test((() => { try { e.run('setupRealApp()'); } catch (er) { return er.message; } })() || ''), '처음 설정은 소유자만');

  // 9-4c2. 메뉴를 안 눌러도: 앱을 처음 열면 자동으로 실제 운세 모드 (한 번만)
  e = makeEnv(); delete e.props.SETUP_REAL; site(e, SAMPLE('20261015')); e.setNow('2026-10-15 10:00');
  const au = e.call(`getHoroscopes()`);
  ok(au.status === 'PUBLISHED' && au.isMock === false && au.items.length === 12, '처음 열면 자동 설정 → 테스트 운세가 아니라 실제 운세');
  ok(e.props.SETUP_REAL === '1' && e.props.MODE === 'PRODUCTION' && e.triggers.length === 1, '자동 설정 기록·트리거');
  e.run(`Settings.set('MODE','TEST')`); e.call(`getHoroscopes()`);
  eq(e.props.MODE, 'TEST', '자동 설정은 한 번만 (나중에 관리자가 바꾼 모드는 그대로)');

  // 9-4d. 앱을 열 때 바로 확인(ON_DEMAND): 트리거를 기다리지 않음
  const prodEnv = (json) => { const x = makeEnv(); site(x, json); x.run(`Settings.set('MODE','PRODUCTION'); Settings.set('AUTO_PUBLISH','true'); Source.patch({authorization_status:'APPROVED'})`); return x; };
  e = prodEnv(SAMPLE('20261015')); e.setNow('2026-10-15 07:40');
  const od = e.call(`getHoroscopes()`);
  ok(od.status === 'PUBLISHED' && od.items.length === 12 && e.fetchLog.length === 1, '앱을 열면 오늘 운세를 바로 가져와 보여줌');
  eq(e.call(`Db.readAll('import_logs')[0].trigger`), 'ON_DEMAND', '바로 확인 기록이 남음');
  e = prodEnv(SAMPLE('20261015')); e.setNow('2026-10-15 04:30'); e.call(`getHoroscopes()`);
  eq(e.fetchLog.length, 0, '새벽 5시 전에는 바로 확인하지 않음');
  e = prodEnv(SAMPLE('20261014')); e.setNow('2026-10-15 07:40');
  e.call(`getHoroscopes()`); e.call(`getHoroscopes()`); e.call(`getHoroscopes()`);
  eq(e.fetchLog.length, 1, '아직 없을 때 여러 번 열어도 10분에 한 번만 확인');
  const pend = e.call(`getHoroscopes()`);
  ok(pend.status === 'PENDING' && pend.items.length === 0 && pend.latestDate === '2026-10-14', '오늘 운세가 없으면 PENDING + 가장 최근 날짜 안내(오늘 운세로 쓰지 않음)');
  ok(e.call(`getHoroscopes('2026-10-14')`).status === 'PUBLISHED', '최근 날짜 운세는 그 날짜로 볼 수 있음');
  e = prodEnv(SAMPLE('20261015')); e.setNow('2026-10-15 08:00'); e.run('tick()'); e.fetchLog.length = 0;
  e.call(`getHoroscopes()`);
  eq(e.fetchLog.length, 0, '자동 확인 직후에는 다시 조회하지 않음');
  e = prodEnv(SAMPLE('20261015')); e.fetchHandler = () => ({ code: 403, body: '{}' }); e.setNow('2026-10-15 07:40');
  e.call(`getHoroscopes()`); e.call(`getHoroscopes()`);
  ok(e.fetchLog.length === 1 && e.cache['OD:2026-10-15'] === 'stop', '사이트가 막으면(403) 멈추고 다시 조르지 않음');
  e = makeEnv(); site(e, SAMPLE('20261015')); e.setNow('2026-10-15 07:40'); e.call(`getHoroscopes()`);
  eq(e.fetchLog.length, 0, 'TEST 모드에서는 공식 사이트를 부르지 않음');

  // 9-5. 일부 누락 → 검증 실패, 공개 안 됨
  e = makeEnv(); site(e, SAMPLE('20261015', { drop: 3 }));
  e.run(`Settings.set('MODE','PRODUCTION'); Settings.set('AUTO_PUBLISH','true'); Source.patch({authorization_status:'APPROVED'})`);
  e.setNow('2026-10-15 08:00'); e.run('tick()');
  const miss = e.call(`HoroscopeRepo.rowsForDate('2026-10-15','PRODUCTION')`);
  ok(miss.length === 11 && miss.every(r => r.validation_status === 'INVALID' && r.publication_status === 'REVIEW'), '11개뿐이면 검증 실패·검수 대기');
  eq(e.call(`getHoroscopes().status`), 'PENDING', '공개되지 않음');

  // 9-6. 사이트 오류 처리
  const err = (code, body, expect, sleeps) => {
    const x = makeEnv(); x.run(`Settings.set('MODE','PRODUCTION')`);
    x.fetchHandler = () => ({ code, body });
    x.setNow('2026-10-15 08:00'); x.run('tick()');
    const l = x.call(`Db.readAll('import_logs')[0]`);
    ok(l.import_status === 'FAILED' && l.error_message.indexOf(expect) >= 0, `사이트 HTTP ${code} → ${expect}`);
    eq(x.sleeps, sleeps, `HTTP ${code}: 재시도 대기 횟수`);
  };
  err(403, '{}', 'FORBIDDEN', 0); err(429, '{}', 'RATE_LIMIT', 0); err(404, '{}', 'NOT_FOUND', 0); err(503, '{}', 'SERVER', 2); err(200, '<html>not json</html>', 'FORMAT', 0);

  // 9-7. 관리자 설정에서 수집 경로 변경
  e = makeEnv(); e.run(`Settings.set('ADMIN_TOKEN', ${j(TOKEN)})`);
  eq(e.call(`adminOverview(${j(TOKEN)}).settings.PROD_SOURCE`), 'SITE', '관리자: 기본 수집 경로 SITE');
  eq(e.call(`adminSetSettings(${j(TOKEN)}, {PROD_SOURCE:'X'}).settings.PROD_SOURCE`), 'X', '관리자: 수집 경로 X로 변경');
  ok(/수집 경로/.test((() => { try { e.call(`adminSetSettings(${j(TOKEN)}, {PROD_SOURCE:'HACK'})`); } catch (er) { return er.message; } })() || ''), '관리자: 잘못된 수집 경로 거부');
}

// ============================================================ 10. AI 에이전트 (가짜 Gemini)
{
  const KEY = 'AIza-SECRET-KEY-123';
  const gem = (e, handler) => {
    e.calls = [];
    e.fetchHandler = (url, opt) => {
      if (!/generativelanguage\.googleapis\.com/.test(url)) return { code: 404, body: '{}' };
      const body = JSON.parse(opt.payload); e.calls.push({ url, headers: opt.headers, body });
      return handler(body, e.calls.length);
    };
  };
  const textReply = t => ({ code: 200, body: { candidates: [{ content: { role: 'model', parts: [{ text: t }] } }] } });
  const callReply = (name, args, extra = {}) => ({ code: 200, body: { candidates: [{ content: { role: 'model', parts: [Object.assign({ functionCall: { name, args } }, extra)] } }] } });
  const ask = (e, req) => e.call(`aiChat(${j(req)})`);
  const fresh = (key = true) => { const e = makeEnv(); if (key) e.run(`Settings.set('GEMINI_API_KEY', ${j(KEY)})`); e.setNow('2026-10-15 09:00'); return e; };

  // 10-1. 키 없음 / 꺼짐
  let e = fresh(false);
  eq(ask(e, { message: '안녕' }).code, 'NOT_CONFIGURED', 'AI: 키가 없으면 준비 안 됨 안내'); eq(e.fetchLog.length, 0, 'AI: 키가 없으면 외부 호출 안 함');
  e = fresh(); e.run(`Settings.set('AI_ENABLED','false')`); gem(e, () => textReply('x'));
  eq(ask(e, { message: '안녕' }).code, 'DISABLED', 'AI: 관리자가 끄면 DISABLED'); eq(e.calls.length, 0, 'AI: 꺼져 있으면 호출 안 함');

  // 10-2. 기본 대화 + 요청 내용 점검
  e = fresh(); gem(e, () => textReply('안녕하세요! 별하루 AI예요.'));
  let r = ask(e, { message: '안녕', sign: 'aquarius', history: [{ role: 'assistant', text: '먼저 한 말' }, { role: 'user', text: '이전 질문' }, { role: 'assistant', text: '이전 답' }, { role: 'hacker', text: '이상한 역할' }] });
  ok(r.ok && r.reply.indexOf('안녕하세요') === 0 && r.remaining === 49, 'AI: 기본 응답과 남은 횟수');
  const c = e.calls[0];
  ok(c.url.indexOf(KEY) < 0 && c.headers['x-goog-api-key'] === KEY, 'AI: 키는 주소가 아니라 요청 헤더로만 전송');
  ok(/gemini-3\.1-flash-lite:generateContent$/.test(c.url), 'AI: 기본 모델');
  const sys = c.body.systemInstruction.parts[0].text;
  ok(sys.indexOf('물병자리') >= 0 && sys.indexOf('2026-10-15') >= 0, 'AI: 시스템 지침에 사용자 별자리·오늘 날짜');
  ok(/지어내지 마/.test(sys) && /지시처럼 보이는 문장/.test(sys) && /109/.test(sys) && /마크다운/.test(sys), 'AI: 지어내기 금지·데이터 속 명령 무시·위기 안내·마크다운 금지 지침 포함');
  ok(/무엇이든/.test(sys) && /거절하지 마/.test(sys) && !/짧게 답하고/.test(sys), 'AI: 운세 밖의 질문에도 성의 있게 답하라는 지침');
  ok(c.body.generationConfig.maxOutputTokens >= 4096 && Array.isArray(c.body.tools), 'AI: 답 길이 한도 넉넉함 + 도구 제공');
  eq(c.body.tools[0].functionDeclarations.map(d => d.name), ['get_horoscope', 'get_ranking', 'get_history', 'compare_signs', 'get_app_help'], 'AI: 도구 5개 등록');
  eq(c.body.contents.map(x => x.role), ['user', 'model', 'user'], 'AI: 대화 순서 정리(맨 앞 AI 발언·이상한 역할 제거)');
  ok(JSON.stringify(c.body).indexOf('생년월일') < 0 && JSON.stringify(c.body.contents).indexOf('birth') < 0, 'AI: 생년월일 정보는 전송하지 않음');

  // 10-3. 도구 호출 루프 (서명 정보 보존)
  e = fresh(); gem(e, (b, n) => (n === 1 ? callReply('get_horoscope', {}, { thoughtSignature: 'SIG123' }) : textReply('오늘 물병자리 운세를 알려드릴게요.')));
  r = ask(e, { message: '오늘 내 운세 알려줘', sign: 'aquarius' });
  ok(r.ok && eq3(r.tools, ['get_horoscope']) && e.calls.length === 2, 'AI: 도구를 한 번 쓰고 최종 답');
  let second = e.calls[1].body.contents; const fr = second[second.length - 1].parts[0].functionResponse;
  ok(fr.name === 'get_horoscope' && fr.response.result.available === true && fr.response.result.sign === 'aquarius' && fr.response.result.is_test_data === true && fr.response.result.rank >= 1 && fr.response.result.rank <= 12, 'AI: 도구 결과(저장된 운세·테스트 데이터 표시)를 모델에 전달');
  eq(second[second.length - 2].parts[0].thoughtSignature, 'SIG123', 'AI: 모델이 준 서명 정보를 그대로 되돌려줌');
  function eq3(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  // 10-4. 도구 입력 검증
  const tool = (name, args, sign = 'leo') => e.call(`AiTools.run(${j(name)}, ${j(args)}, ${j({ sign, today: '2026-10-15' })})`);
  ok(/알 수 없는 별자리/.test(tool('get_horoscope', { sign: 'dragon' }).error), '도구: 이상한 별자리는 오류 결과');
  ok(/형식/.test(tool('get_horoscope', { date: '내일' }).error), '도구: 이상한 날짜는 오류 결과');
  ok(/알 수 없는 도구/.test(tool('delete_everything', {}).error), '도구: 없는 도구 이름은 오류 결과');
  ok(tool('get_horoscope', { sign: '양자리' }).sign === 'aries', '도구: 한국어 별자리 이름도 인식');
  eq(tool('get_horoscope', { date: '2026-12-31' }).available, false, '도구: 미래 날짜는 운세 없음');
  const h = tool('get_history', { days: 999 }); ok(h.days === 31 && h.records.length === 31, '도구: 기록 일수는 최대 31로 제한');
  ok(h.record_count > 0 && h.average_rank >= 1 && h.best.rank <= h.worst.rank, '도구: 기록 요약(평균·최고·최저)');
  const rk = tool('get_ranking', {}); ok(rk.ranking.length === 12 && rk.ranking[0].rank === 1 && rk.is_test_data, '도구: 전체 순위 12개');
  const cmp = tool('compare_signs', { sign_b: 'pisces' }); ok(cmp.a.sign === 'leo' && cmp.b.sign === 'pisces' && typeof cmp.rank_gap === 'number' && /공식 정보가 아니에요/.test(cmp.note), '도구: 별자리 비교(궁합 점수는 공식 아님 표시)');
  ok(tool('compare_signs', {}).error, '도구: 비교 대상이 없으면 오류 결과');
  ok(tool('get_app_help', { topic: 'notification' }).text.indexOf('알림') >= 0 && Object.keys(tool('get_app_help', { topic: '??' }).topics).length >= 6, '도구: 앱 안내');
  e.run(`Settings.set('MODE','PRODUCTION')`);
  ok(tool('get_horoscope', {}).available === false, '도구: 운영 모드에서 데이터가 없으면 지어내지 않고 "없음"');

  // 10-5. 잘못된 도구 인자가 와도 대화는 이어진다
  e = fresh(); gem(e, (b, n) => (n === 1 ? callReply('get_horoscope', { sign: 'dragon' }) : textReply('그 별자리는 모르겠어요.')));
  r = ask(e, { message: '용자리 운세', sign: 'leo' });
  ok(r.ok && /알 수 없는 별자리/.test(e.calls[1].body.contents.slice(-1)[0].parts[0].functionResponse.response.result.error), 'AI: 도구 오류도 모델에 전달되어 대화가 이어짐');

  // 10-6. 도구 반복 제한
  e = fresh(); gem(e, () => callReply('get_ranking', {}));
  r = ask(e, { message: '계속 돌려' });
  ok(r.ok && e.calls.length === 5 && /끝내지 못했어요/.test(r.reply), 'AI: 도구 호출은 최대 5번, 무한 반복 없음');

  // 10-7. 마크다운 제거
  e = fresh(); gem(e, () => textReply('**오늘** 운세예요\n# 제목\n* 항목 하나\n`코드` [링크](http://x.com)\n```js\nabc\n```'));
  r = ask(e, { message: '형식' });
  ok(!/[*#`]|\]\(/.test(r.reply) && r.reply.indexOf('오늘 운세예요') === 0 && r.reply.indexOf('- 항목 하나') > 0 && r.reply.indexOf('링크') > 0, 'AI: 응답의 마크다운 기호 제거');
  e = fresh(); gem(e, () => textReply('가'.repeat(5000)));
  eq(ask(e, { message: '길게' }).reply.length, 4000, 'AI: 답변 길이 제한');

  // 10-7b. 빈 답(생각에 한도를 다 씀) → 한 번 다시 부탁해서 답을 받음
  e = fresh(); gem(e, (b, n) => (n === 1 ? { code: 200, body: { candidates: [{ finishReason: 'MAX_TOKENS', content: { role: 'model', parts: [{ text: '속생각', thought: true }] } }] } } : textReply('김치찌개 어때요?')));
  r = ask(e, { message: '점심 메뉴 추천해줘' });
  ok(r.ok && r.reply === '김치찌개 어때요?' && e.calls.length === 2, 'AI: 빈 답이면 한 번 더 요청해서 답함 (생각 내용은 화면에 안 보임)');
  e = fresh(); gem(e, () => ({ code: 200, body: { candidates: [{ finishReason: 'MAX_TOKENS', content: { role: 'model', parts: [] } }] } }));
  r = ask(e, { message: '질문' });
  ok(!r.ok && r.code === 'AI_ERROR' && e.calls.length === 2, 'AI: 두 번 연속 빈 답이면 쉬운 오류 안내');
  e = fresh(); gem(e, () => ({ code: 200, body: { promptFeedback: { blockReason: 'SAFETY' } } }));
  r = ask(e, { message: '질문' });
  ok(r.ok && r.blocked && /표현을/.test(r.reply) && e.calls.length === 1, 'AI: 안전 차단은 다시 묻지 않고 안내');
  // 10-7c. 마지막 차례에는 도구를 빼서 답을 끝내게 함
  e = fresh(); gem(e, () => callReply('get_ranking', {}));
  ask(e, { message: '계속' });
  ok(e.calls.slice(0, 4).every(x => Array.isArray(x.body.tools)) && !e.calls[4].body.tools, 'AI: 마지막 요청에는 도구를 빼고 답만 하게 함');

  // 10-8. 입력 검증
  e = fresh(); gem(e, () => textReply('ok'));
  eq(ask(e, { message: '   ' }).code, 'INVALID', 'AI: 빈 질문 거절'); eq(ask(e, null).code, 'INVALID', 'AI: 잘못된 요청 거절');
  eq(ask(e, { message: 'a'.repeat(501) }).code, 'INVALID', 'AI: 500자 초과 거절'); eq(e.calls.length, 0, 'AI: 거절한 요청은 외부 호출·횟수 차감 없음');
  const hist = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: '대화' + i }));
  ask(e, { message: '마지막', history: hist, sign: 'drag0n' });
  ok(e.calls[0].body.contents.length <= 11 && e.calls[0].body.systemInstruction.parts[0].text.indexOf('(아직 모름)') > 0, 'AI: 대화는 최근 10개만, 이상한 별자리 값은 무시');

  // 10-9. 하루 사용 한도
  e = fresh(); e.run(`Settings.set('AI_DAILY_LIMIT','2')`); gem(e, () => textReply('답'));
  ok(ask(e, { message: '1' }).remaining === 1 && ask(e, { message: '2' }).remaining === 0, 'AI: 남은 횟수 감소');
  const lim = ask(e, { message: '3' }); ok(lim.code === 'LIMIT' && e.calls.length === 2, 'AI: 한도를 넘으면 거절하고 외부 호출 안 함');
  e.setNow('2026-10-16 09:00'); ok(ask(e, { message: '다음날' }).ok, 'AI: 다음 날에는 한도가 다시 채워짐');

  // 10-10. API 오류
  e = fresh(); gem(e, () => ({ code: 429, body: { error: { message: 'quota exceeded' } } }));
  r = ask(e, { message: '질문' });
  ok(r.ok === false && r.code === 'AI_BUSY' && /바빠요/.test(r.message) && !/429|quota|AIza/.test(r.message), 'AI: 혼잡할 땐 "바빠요"라고 쉬운 말로 안내(내부 정보 숨김)');
  ok(e.calls.length === 3 && e.sleeps === 2, 'AI: 혼잡(429/503)은 최대 3번(2번 기다리며) 시도하고 멈춤');
  eq(e.call('AiAgent.usedToday()'), 0, 'AI: 실패하면 사용 횟수를 돌려줌');
  e = fresh(); gem(e, () => ({ code: 404, body: { error: { message: 'models/xyz is not found ' + KEY } } }));
  ask(e, { message: '질문' });
  const le = e.call(`Settings.get('AI_LAST_ERROR','')`); ok(/HTTP 404/.test(le) && le.indexOf(KEY) < 0 && e.calls.length === 1, 'AI: 마지막 오류를 관리자용으로 저장(키는 가림), 404는 재시도 없음');
  e = fresh(); gem(e, () => ({ code: 200, body: { promptFeedback: { blockReason: 'SAFETY' } } }));
  ok(/답하기 어려워요/.test(ask(e, { message: '질문' }).reply), 'AI: 안전 필터로 막히면 안내 문구');
  e = fresh(); e.ctx.UrlFetchApp.fetch = () => { throw new Error('timeout'); };
  ok(ask(e, { message: '질문' }).code === 'AI_ERROR' && e.sleeps === 2, 'AI: 네트워크 장애는 일반 오류 안내, 최대 3번 시도');

  // 10-12. 503 혼잡 → 예비 모델로 자동 전환
  e = fresh(); e.run(`Settings.set('GEMINI_FALLBACK_MODEL','gemini-2.5-flash')`);
  gem(e, () => ({ code: 503, body: { error: { message: 'This model is currently experiencing high demand.' } } }));
  r = ask(e, { message: '질문' }); ok(r.code === 'AI_BUSY' && e.calls.length === 6, 'AI: 기본 모델 3번 + 예비 모델 3번 시도 후 안내');
  e = fresh(); e.run(`Settings.set('GEMINI_FALLBACK_MODEL','gemini-2.5-flash')`);
  gem(e, (b, n) => (n <= 3 ? { code: 503, body: { error: { message: 'high demand' } } } : textReply('예비 모델이 답했어요.')));
  r = ask(e, { message: '질문' });
  ok(r.ok && r.reply.indexOf('예비 모델') === 0 && /gemini-3\.1-flash-lite/.test(e.calls[0].url) && /gemini-2\.5-flash:/.test(e.calls[3].url), 'AI: 기본 모델이 계속 혼잡하면 예비 모델로 자동 전환');
  e = fresh(); e.run(`Settings.set('GEMINI_FALLBACK_MODEL','gemini-2.5-flash')`);
  gem(e, () => ({ code: 404, body: { error: { message: 'model not found' } } }));
  ask(e, { message: '질문' }); ok(e.calls.length === 1, 'AI: 모델 이름 오류(404)는 예비 모델로 넘어가지 않고 바로 멈춤');
  e = fresh(); e.run(`Settings.set('GEMINI_FALLBACK_MODEL','x')`); gem(e, () => textReply('a'));
  e.run(`Settings.set('ADMIN_TOKEN', ${j(TOKEN)})`);
  ok(e.call(`adminSetSettings(${j(TOKEN)}, {GEMINI_FALLBACK_MODEL: 'gemini-2.5-flash'})`).ai.fallbackModel === 'gemini-2.5-flash', '관리자: 예비 모델 설정');
  ok(/예비 모델/.test((() => { try { e.call(`adminSetSettings(${j(TOKEN)}, {GEMINI_FALLBACK_MODEL: 'bad name!'})`); } catch (er) { return er.message; } })() || ''), '관리자: 잘못된 예비 모델 이름 거부');
  // 10-13. 예비 모델 자동 선택
  const pick = (names, cur) => e.call(`pickFallbackModel_(${j(names)}, ${j(cur)})`);
  const NAMES = ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash-image', 'gemini-embedding-001', 'gemini-2.5-flash-preview-tts', 'gemma-3-27b-it', 'gemini-flash-latest'];
  eq(pick(NAMES, 'gemini-3.1-flash-lite'), 'gemini-2.5-flash', '예비 모델 선택: 안정적인 flash 중 버전이 높은 것 (lite·미리보기·이미지·음성·임베딩 제외)');
  eq(pick(['gemini-2.5-flash', 'gemini-2.0-flash'], 'gemini-2.5-flash'), 'gemini-2.0-flash', '예비 모델 선택: 현재 기본 모델은 제외');
  eq(pick(['gemini-2.5-pro', 'gemini-3.1-flash-lite'], 'gemini-3.1-flash-lite'), 'gemini-2.5-pro', '예비 모델 선택: flash가 없으면 pro');
  eq(pick(['gemini-3.1-flash-lite', 'gemini-embedding-001'], 'gemini-3.1-flash-lite'), '', '예비 모델 선택: 후보가 없으면 빈 값(저장 안 함)');
  e = fresh(); e.fetchHandler = (url) => (/\/models\?pageSize/.test(url)
    ? { code: 200, body: { models: NAMES.map(n => ({ name: 'models/' + n, supportedGenerationMethods: n.indexOf('embedding') >= 0 ? ['embedContent'] : ['generateContent'] })) } }
    : { code: 404, body: '{}' });
  e.run('autoSetFallbackModel()');
  eq(e.call(`Settings.get('GEMINI_FALLBACK_MODEL','')`), 'gemini-2.5-flash', '자동 설정: 예비 모델이 저장됨');
  e.user.act = 'visitor@x.com'; ok(/소유자/.test((() => { try { e.run('autoSetFallbackModel()'); } catch (er) { return er.message; } })() || ''), '자동 설정은 소유자만 실행 가능');
  // 10-11. 관리자 연동
  e = fresh(); e.run(`Settings.set('ADMIN_TOKEN', ${j(TOKEN)})`);
  const ov = e.call(`adminOverview(${j(TOKEN)})`);
  ok(ov.secrets.gemini === true && ov.ai.dailyLimit === 50 && ov.ai.usedToday === 0 && JSON.stringify(ov).indexOf(KEY) < 0, '관리자: AI 상태 표시(키 값은 노출 안 됨)');
  const ov2 = e.call(`adminSetSettings(${j(TOKEN)}, {AI_DAILY_LIMIT: 5, GEMINI_MODEL: 'gemini-2.5-flash', AI_ENABLED: false})`);
  ok(ov2.ai.dailyLimit === 5 && ov2.ai.model === 'gemini-2.5-flash' && ov2.ai.enabled === false, '관리자: AI 설정 변경');
  const bad = (chg) => { try { e.call(`adminSetSettings(${j(TOKEN)}, ${j(chg)})`); } catch (er) { return er.message; } };
  ok(/한도/.test(bad({ AI_DAILY_LIMIT: 0 }) || '') && /모델 이름/.test(bad({ GEMINI_MODEL: 'bad model!!' }) || ''), '관리자: 잘못된 AI 설정 거부');
  const t = (() => { try { e.call(`adminOverview('x')`); } catch (er) { return er.message; } })(); ok(/DENIED/.test(t), '관리자: 인증 없이 AI 상태 조회 불가');
  // 소유자 전용 모델 조회
  const e3 = fresh(); e3.user.act = 'visitor@x.com'; ok(/소유자/.test((() => { try { e3.run('listGeminiModels()'); } catch (er) { return er.message; } })() || ''), '방문자는 모델 목록 조회 불가');
}
console.log(`\n통과 ${passes} / 실패 ${fails}`);
process.exit(fails ? 1 : 0);
