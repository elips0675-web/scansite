export const spfPolicy = (value) => {
  if (/\+all\b/i.test(value)) return { level: 'fail', note: '+all разрешает отправку всем: SPF не защищает' };
  if (/\?all\b/i.test(value)) return { level: 'fail', note: '?all — нейтральная политика: SPF ничего не запрещает' };
  if (/~all\b/i.test(value)) return { level: 'warn', note: '~all — soft fail: часть подделок всё равно принимается' };
  if (/-all\b/i.test(value)) return { level: 'ok', note: '-all — строгий запрет' };
  return { level: 'warn', note: 'нет механизма all: политика неполная' };
};

export const dmarcPolicy = (value) => {
  const policy = (value.match(/\bp\s*=\s*(none|quarantine|reject)/i) || [, ''])[1].toLowerCase();
  if (policy === 'reject') return { level: 'ok', note: 'p=reject — подделки отклоняются' };
  if (policy === 'quarantine') return { level: 'warn', note: 'p=quarantine — в спам, а не отказ' };
  if (policy === 'none') return { level: 'fail', note: 'p=none — только наблюдение, подделки принимаются' };
  return { level: 'warn', note: 'политика p не задана' };
};
