/**
 * 일본어 별자리 이름 → 내부 식별자(영문) 변환
 * 별칭을 추가하려면 아래 ZODIAC_ALIASES 목록에 적기만 하면 된다.
 * 매칭은 "가타카나→히라가나, 전각 숫자→반각" 처리 후 하므로 오히려 おひつじ座 / オヒツジ座 는 같은 것으로 취급된다.
 */
const ZODIAC_ALIASES = {
  aries:       ['おひつじ座', '牡羊座', '羊座', '양자리', '♈'],
  taurus:      ['おうし座', '牡牛座', '황소자리', '♉'],
  gemini:      ['ふたご座', '双子座', '쌍둥이자리', '♊'],
  cancer:      ['かに座', '蟹座', '게자리', '♋'],
  leo:         ['しし座', '獅子座', '사자자리', '♌'],
  virgo:       ['おとめ座', '乙女座', '처녀자리', '♍'],
  libra:       ['てんびん座', '天秤座', '天びん座', '천칭자리', '♎'],
  scorpio:     ['さそり座', '蠍座', '전갈자리', '♏'],
  sagittarius: ['いて座', '射手座', '사수자리', '♐'],
  capricorn:   ['やぎ座', '山羊座', '염소자리', '♑'],
  aquarius:    ['みずがめ座', '水瓶座', '물병자리', '♒'],
  pisces:      ['うお座', '魚座', '물고기자리', '♓'],
};

/** 길이를 바꾸지 않는 매칭용 변환: 전각 숫자/콜론/공백 → 반각, 가타카나 → 히라가나, 영문 → 소문자 */
function matchForm_(s) {
  return String(s).replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/：/g, ':').replace(/　/g, ' ')
    .replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); })
    .toLowerCase();
}

// 긴 별칭부터 검사하기 위해 정렬해 둔 [별칭(매칭용), key] 목록
const ZODIAC_ALIAS_LIST_ = (function () {
  const list = [];
  Object.keys(ZODIAC_ALIASES).forEach(function (key) {
    ZODIAC_ALIASES[key].forEach(function (a) { list.push([matchForm_(a), key]); });
  });
  list.sort(function (a, b) { return b[0].length - a[0].length; });
  return list;
})();

/** 한 줄 안에서 가장 먼저 나오는 별자리를 찾는다. 없으면 null. @return {{key:string, index:number, length:number}|null} */
function findSignInText_(text) {
  const m = matchForm_(text);
  let best = null;
  ZODIAC_ALIAS_LIST_.forEach(function (pair) {
    const i = m.indexOf(pair[0]);
    if (i >= 0 && (best === null || i < best.index || (i === best.index && pair[0].length > best.length))) {
      best = { key: pair[1], index: i, length: pair[0].length };
    }
  });
  return best;
}

/** 별자리 이름 하나(예: 'おひつじ座')를 key로. 정확히 일치할 때만 변환한다. */
function zodiacKeyFromName_(name) {
  const m = matchForm_(String(name).trim());
  for (let i = 0; i < ZODIAC_ALIAS_LIST_.length; i++) if (ZODIAC_ALIAS_LIST_[i][0] === m) return ZODIAC_ALIAS_LIST_[i][1];
  return null;
}

/** 문서 안에서 서로 다른 별자리가 몇 종류 등장하는지 */
function countDistinctSigns_(text) {
  const m = matchForm_(text), seen = {};
  ZODIAC_ALIAS_LIST_.forEach(function (pair) { if (m.indexOf(pair[0]) >= 0) seen[pair[1]] = true; });
  return Object.keys(seen).length;
}
