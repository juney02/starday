/**
 * TEST MODE용 가상 X 게시물
 * - 실제 오하아사 운세가 아니다. 모든 문장에 "テスト用"을 넣고, 출처를 [TEST]로 표시한다.
 * - X API 키 없이 "수집 → 분석 → 검증 → 저장 → 번역 → 공개" 전체 흐름을 시험하기 위한 것.
 * - 관리자 화면의 "테스트 시나리오"로 실패 상황(순위 중복, 별자리 누락, 날짜 불일치, 이미지 게시물, 게시물 없음)도 재현한다.
 */
const TEST_AUTHOR_ID = 'TEST_AUTHOR';

// [일본어 문장, 한국어 번역]
const TEST_CONTENTS_ = [
  ['テスト用の文章です。新しいことを始めるのによい一日になりそうです。', '테스트용 문장입니다. 새로운 일을 시작하기에 좋은 하루가 될 것 같아요.'],
  ['テスト用の文章です。ゆっくり休むと気持ちが整います。', '테스트용 문장입니다. 푹 쉬면 마음이 정돈돼요.'],
  ['テスト用の文章です。身近な人との会話が楽しい日です。', '테스트용 문장입니다. 가까운 사람과의 대화가 즐거운 날이에요.'],
  ['テスト用の文章です。持ち物の整理がうまくいきそうです。', '테스트용 문장입니다. 소지품 정리가 잘 될 것 같아요.'],
  ['テスト用の文章です。小さな幸運が舞い込むかもしれません。', '테스트용 문장입니다. 작은 행운이 찾아올지도 몰라요.'],
  ['テスト用の文章です。集中力が高まる一日です。', '테스트용 문장입니다. 집중력이 높아지는 하루예요.'],
  ['テスト用の文章です。散歩で気分転換をしましょう。', '테스트용 문장입니다. 산책으로 기분 전환을 해 보세요.'],
  ['テスト用の文章です。落ち着いて行動すると吉です。', '테스트용 문장입니다. 차분하게 행동하면 좋아요.'],
  ['テスト用の文章です。感謝の気持ちを伝えてみましょう。', '테스트용 문장입니다. 감사한 마음을 전해 보세요.'],
  ['テスト用の文章です。確認をていねいにすると安心です。', '테스트용 문장입니다. 꼼꼼히 확인하면 안심이에요.'],
  ['テスト用の文章です。勇気を出して一歩踏み出しましょう。', '테스트용 문장입니다. 용기를 내어 한 걸음 내디뎌 보세요.'],
  ['テスト用の文章です。自分をいたわる時間を持ちましょう。', '테스트용 문장입니다. 나를 돌보는 시간을 가져 보세요.'],
];
const TEST_ITEMS_ = [
  ['青いノート', '파란 노트'], ['温かいお茶', '따뜻한 차'], ['銀のペン', '은색 펜'], ['小さな鉢植え', '작은 화분'],
  ['ハンカチ', '손수건'], ['マグカップ', '머그컵'], ['イヤホン', '이어폰'], ['運動靴', '운동화'],
  ['メモ帳', '메모장'], ['チェックリスト', '체크리스트'], ['黄色い靴下', '노란 양말'], ['キャンドル', '캔들'],
];
const TEST_COLORS_ = [['青', '파란색'], ['金色', '금색'], ['銀色', '은색'], ['紫', '보라색'], ['水色', '하늘색'], ['白', '흰색']];
// 표기 다양성 테스트용: 짝수 번째 별자리는 가타카나, 그다음은 한자, 그다음은 히라가나로 적는다
const TEST_SIGN_NAMES_ = {
  aries: ['おひつじ座', 'オヒツジ座', '牡羊座'], taurus: ['おうし座', 'オウシ座', '牡牛座'], gemini: ['ふたご座', 'フタゴ座', '双子座'],
  cancer: ['かに座', 'カニ座', '蟹座'], leo: ['しし座', 'シシ座', '獅子座'], virgo: ['おとめ座', 'オトメ座', '乙女座'],
  libra: ['てんびん座', 'テンビン座', '天秤座'], scorpio: ['さそり座', 'サソリ座', '蠍座'], sagittarius: ['いて座', 'イテ座', '射手座'],
  capricorn: ['やぎ座', 'ヤギ座', '山羊座'], aquarius: ['みずがめ座', 'ミズガメ座', '水瓶座'], pisces: ['うお座', 'ウオ座', '魚座'],
};

const TestFeed = {
  scenarios: ['normal', 'none', 'duplicate_rank', 'missing_sign', 'wrong_date', 'image_only'],

  /** 번역 사전 (TEST 모드에서 외부 번역 API 없이 번역을 흉내 낸다) */
  translations: function () {
    const m = {};
    TEST_CONTENTS_.concat(TEST_ITEMS_, TEST_COLORS_).forEach(function (p) { m[p[0]] = p[1]; });
    return m;
  },

  /** 해당 날짜의 가상 게시물들. XClient.getRecentPosts()와 같은 모양으로 반환한다. */
  getPosts: function (date, scenario) {
    scenario = scenario || 'normal';
    const noise = this.noisePosts_(date);
    if (scenario === 'none') return noise;
    if (scenario === 'image_only') {
      return noise.concat([this.post_(date, '07:58', '今日の12星座占いをお届けします（テスト投稿・画像）', 1, { media: [{ type: 'photo', url: 'https://example.invalid/test-image.png' }] })]);
    }

    const rng = makeRng_(seedFromString_('byeolharu-test-feed-' + date));
    const ranks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    for (let i = ranks.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = ranks[i]; ranks[i] = ranks[j]; ranks[j] = t; }

    let entries = ZODIAC_KEYS.map(function (key, i) {
      const names = TEST_SIGN_NAMES_[key];
      return { rank: ranks[i], name: names[i % 3], content: TEST_CONTENTS_[i][0], item: TEST_ITEMS_[(i + ranks[i]) % 12][0], color: TEST_COLORS_[i % 6][0] };
    }).sort(function (a, b) { return a.rank - b.rank; });

    if (scenario === 'duplicate_rank') entries[5].rank = entries[4].rank;           // 5위가 두 개
    if (scenario === 'missing_sign') entries.splice(6, 1);                           // 별자리 하나 누락
    const textDate = scenario === 'wrong_date' ? addDays_(date, -1) : date;

    const line = function (e) {
      return e.rank + '位 ' + e.name + '\n' + e.content + '\nラッキーアイテム：' + e.item + '\nラッキーカラー：' + e.color;
    };
    const md = Number(textDate.slice(5, 7)) + '月' + Number(textDate.slice(8, 10)) + '日';
    const chunks = [entries.slice(0, 4), entries.slice(4, 8), entries.slice(8)];
    const posts = chunks.map(function (chunk, n) {
      const head = n === 0 ? '【テスト投稿】' + md + 'の12星座占い（実際の運勢ではありません）\n' : '';
      return TestFeed.post_(date, '07:5' + (8 + n > 9 ? 9 : 8 + n), head + chunk.map(line).join('\n\n'), n + 1);
    });
    return noise.concat(posts);
  },

  post_: function (date, hhmm, text, n, extra) {
    const p = date.split('-'), t = hhmm.split(':');
    // 한국시간 → UTC ISO
    const iso = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]), Number(t[0]) - 9, Number(t[1]), n)).toISOString();
    return {
      id: 'TEST' + date.replace(/-/g, '') + n, text: text, created_at: iso, author_id: TEST_AUTHOR_ID,
      url: CONFIG.OFFICIAL_ACCOUNT_URL, is_retweet: false, media: (extra && extra.media) || [],
    };
  },

  /** 걸러내야 하는 게시물: 리포스트, 관련 없는 글, 다른 계정이 쓴 가짜 운세 */
  noisePosts_: function (date) {
    const fake = this.post_(date, '07:40', '1位 おひつじ座\n偽の投稿です\n2位 おうし座\n3位 ふたご座', 91);
    fake.author_id = 'SOMEONE_ELSE';
    const rt = this.post_(date, '07:30', 'RT 先週の12星座占いまとめ 1位 しし座', 92);
    rt.is_retweet = true;
    const other = this.post_(date, '07:00', 'おはようございます。今日も一日がんばりましょう（テスト用の関係ない投稿）', 93);
    return [fake, rt, other];
  },
};
