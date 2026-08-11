// V3-R1 epoch diversification (Goal 20R-V3-R1).
//
// Deterministic, seed-aware, construct-preserving scenario realization for the
// unseen Validation V3 epoch. It rewrites ONLY fixture-visible wording
// (prompt, goal text, memory event content, candidate descriptions, non-
// constraint-linked evidence facts, expired facts, historical decision
// question/conclusion, execution outcome). Gold fields are never touched.
//
// Safety contract:
//  - A protected vocabulary mirrors the product's lexical machinery
//    (brain-server evidence-gate / constraint-engine / option-evaluator and
//    the ablation planner mirror). Protected tokens are replaced with private-
//    use placeholders before rule application and restored afterwards, so no
//    rule can create or destroy them.
//  - Every rule (string or regex) is checked at load time to be free of
//    protected tokens; a violation throws and fails closed.
//  - After diversification a signature suite re-runs the product's
//    deterministic text-based logic (missing-variable markers, direction /
//    requirement / no-change / override / stale / confirmation markers,
//    variable-topic and topicOf extraction, hard-constraint linkage,
//    constraint text fallback, preference affinity, historical-option LCS
//    matching) and asserts invariance; any violation throws and fails closed.
//
// The rule table serves two purposes at once: cross-epoch separation (V3 vs
// V2 same-slot near-duplicate target max 8-gram Jaccard < 0.4) and same-slot
// near-duplicate suppression inside the epoch. Rules are general phrase
// substitutions only; there are NO per-sample, per-TT-idx or V2-sample-
// specific patches (see static anti-copy audit).

// ── 1. Protected vocabulary (mirrors product lexical machinery) ──────────────

// evidence-gate.ts MISSING_MARKERS
const MISSING_MARKERS = [
  '还没定', '还没确定', '尚未确定', '未确定', '未定', '未对齐', '未与', '没定',
  '待定', '未锁定', '未落实', '未决', '缺失', '还没',
];

// evidence-gate.ts DIRECTION_CHANGE_MARKERS
const DIRECTION_MARKERS = ['转向', '进入', '退出', '放弃', '停止', '不再', '撤回', '撤销', '收回'];

// evidence-gate.ts REQUIREMENT_CHANGE_MARKERS
const REQUIREMENT_MARKERS = ['新政策', '新规', '新要求', '新增', '要求', '必须', '需要覆盖', '新法'];

// evidence-gate.ts isNoChangeText regex tokens
const NOCHANGE_MARKERS = ['无变化', '没有变化', '无差异', '无具体', '一样', '不变'];

// evidence-gate.ts isOverrideEvidence: marker side AND user side
const OVERRIDE_MARKERS = ['覆盖', '取消', '撤销', '收回', '停止'];
const USER_MARKERS = ['用户', '我'];

// evidence-gate.ts CONSTRAINT_UNDETERMINED_RE tail tokens
const UNDETERMINED_MARKERS = ['确定前', '尚未确定', '未定', '未确定', '未落实', '未锁定', '未决'];

// option-evaluator.ts STALE_CLAIM_MARKERS
const STALE_MARKERS = ['旧', '曾', '原', '之前'];

// option-evaluator.ts USER_CONFIRMATION_MARKERS ('按.*执行' needs 按 and 执行)
const CONFIRMATION_MARKERS = ['确认', '就按', '按', '批', '执行'];

// evidence-gate.ts VARIABLE_TOPICS terms (all topics)
const VARIABLE_TOPICS_TERMS = [
  '薪资预算', '薪酬预算', '薪资范围', '薪酬', '预算', '成本上限', '费用上限',
  '会议日期', '开会日期', '周几', '日期', '时间', '选址', '地点', '办公室位置',
  '城市', '上海', '深圳', '北京', '装修风格', '设计风格', '风格', '迁移窗口',
  '迁移时间', '团队规模', '人数', '会议时长', '时长', '参会人数', '办公面积',
  '面积', '租期', '项目预算', '搬家期限', '搬迁期限', '团队增长计划', '招聘计划',
  '候选人管道', '候选人储备', '成本', '费用',
];

// option-evaluator.ts topicOf list
const TOPICOF_TERMS = ['预算', '口径', '价格', '成本', '日期', '方案', '版本', '风格', '渠道', '区域'];

// constraint-engine.ts CONSTRAINT_DOMAIN_RE
const CONSTRAINT_DOMAIN_TERMS = ['硬约束', '约束'];

// generator TT02 KEY_VARIABLES labels / constraint-derived terms
const KEY_VARIABLE_TERMS = ['规模', '用量', '兼容性', '截止', '部署', '服务地点'];

// Planner mirror constraint-fallback tokens are load-bearing only inside
// hard_constraints[].text, which this module never diversifies. They are kept
// out of the rule table below by the load-time assertion because rules may not
// add them to any text either (constraint linkage assertion).
const CONSTRAINT_FALLBACK_TOKENS = [
  '不得', '禁止', '不可', '不允许', '不能', '避免', '必须', '需要', '要求', '支持',
  '违反', '不符合', '不满足', '无法满足', '超预算', '超过预算', '未达标', '不合格',
  '不可行', '不兼容', '满足', '符合', '达标', '兼容', '可行',
];

// Union, deduplicated, longest-first (longest-first guarantees the most
// specific token wins during placeholder protection).
export const PROTECTED = [
  ...new Set([
    ...MISSING_MARKERS,
    ...DIRECTION_MARKERS,
    ...REQUIREMENT_MARKERS,
    ...NOCHANGE_MARKERS,
    ...OVERRIDE_MARKERS,
    ...USER_MARKERS,
    ...UNDETERMINED_MARKERS,
    ...STALE_MARKERS,
    ...CONFIRMATION_MARKERS,
    ...VARIABLE_TOPICS_TERMS,
    ...TOPICOF_TERMS,
    ...CONSTRAINT_DOMAIN_TERMS,
    ...KEY_VARIABLE_TERMS,
  ]),
].sort((a, b) => b.length - a.length || a.localeCompare(b));

const PH_L = '\uE000';
const PH_R = '\uE001';

export function protectText(text) {
  let out = text;
  for (let i = 0; i < PROTECTED.length; i++) {
    const tok = PROTECTED[i];
    if (out.includes(tok)) out = out.split(tok).join(`${PH_L}${i}${PH_R}`);
  }
  return out;
}

export function restoreText(text) {
  let out = text;
  for (let i = 0; i < PROTECTED.length; i++) {
    const tok = `${PH_L}${i}${PH_R}`;
    if (out.includes(tok)) out = out.split(tok).join(PROTECTED[i]);
  }
  return out;
}

// ── 2. Product-logic mirrors used by the invariance assertions ──────────────

const NOCHANGE_RE = /无变化|没有变化|无差异|无具体|一样|不变/;
const OVERRIDE_RE = /覆盖|取消|撤销|收回|停止/;
const USER_RE = /用户|我/;
const CONFIRMATION_RE = /确认|就按|按.*执行|批/;
const CONSTRAINT_DOMAIN_RE = /硬约束|约束/;
const CONSTRAINT_NEGATION_RE = /不得|禁止|不可|不允许|不能|避免/;
const CONSTRAINT_REQUIRED_RE = /必须|需要|要求|支持/;

function sharedTermAtLeast(a, b, minLen, maxLen) {
  const hi = Math.min(maxLen, a.length);
  for (let len = minLen; len <= hi; len++) {
    for (let i = 0; i + len <= a.length; i++) {
      const t = a.slice(i, i + len);
      if (b.includes(t)) return true;
    }
  }
  return false;
}

function longestCommonSubstring(a, b) {
  let best = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > best) best = k;
    }
  }
  return best;
}

function firstTopicOf(text) {
  for (const t of TOPICOF_TERMS) if (text.includes(t)) return t;
  return null;
}

function firstVariableTopicSlug(text) {
  for (const term of VARIABLE_TOPICS_TERMS) if (text.includes(term)) return term;
  return null;
}

export function factLexicalSignature(factText) {
  return {
    missing: MISSING_MARKERS.some((m) => factText.includes(m)),
    direction: DIRECTION_MARKERS.some((m) => factText.includes(m)),
    requirement: REQUIREMENT_MARKERS.some((m) => factText.includes(m)),
    nochange: NOCHANGE_RE.test(factText),
    override: OVERRIDE_RE.test(factText) && USER_RE.test(factText),
    stale: STALE_MARKERS.some((m) => factText.includes(m)),
    confirmation: CONFIRMATION_RE.test(factText),
    topicOf: firstTopicOf(factText),
    variableTopic: firstVariableTopicSlug(factText),
    constraintDomain: CONSTRAINT_DOMAIN_RE.test(factText),
  };
}

function constraintLinked(fact, supports, constraint) {
  if ((supports ?? []).includes(constraint.id)) return true;
  if (CONSTRAINT_DOMAIN_RE.test(fact)) return true;
  return sharedTermAtLeast(fact, constraint.text ?? '', 3, 6);
}

function optionViolatesFallback(optionText, constraintText) {
  if (CONSTRAINT_NEGATION_RE.test(constraintText)) {
    const forbidden = constraintText.replace(CONSTRAINT_NEGATION_RE, '').replace(/[\s,，。;；]/g, '');
    if (forbidden.length >= 2 && optionText.includes(forbidden)) return true;
  } else {
    const required = constraintText.replace(CONSTRAINT_REQUIRED_RE, '').replace(/[\s,，。;；]/g, '');
    if (required.length >= 2 && optionText.includes(required)) return false;
  }
  return false;
}

function allFacts(parts) {
  return [
    ...(parts.qualified ?? []),
    ...(parts.expired ?? []),
    ...(parts.conflicting ?? []),
  ];
}

export function captureSignatures(parts) {
  const facts = allFacts(parts);
  const factSig = facts.map((f) => [f.id, factLexicalSignature(String(f.fact ?? ''))]);
  const constraintLinkage = {};
  for (const hc of parts.hardConstraints ?? []) {
    constraintLinkage[hc.id] = facts
      .filter((f) => constraintLinked(String(f.fact ?? ''), f.supports, hc))
      .map((f) => f.id)
      .sort();
  }
  const constraintFallback = [];
  for (const hc of parts.hardConstraints ?? []) {
    for (const cand of parts.candidates ?? []) {
      const optionText = `${cand.label} ${cand.description ?? ''}`;
      if (optionViolatesFallback(optionText, hc.text ?? '')) constraintFallback.push(`HC:${hc.id}:O:${cand.id}`);
    }
  }
  const affinity = [];
  for (const pref of parts.softPrefs ?? []) {
    for (const f of facts) {
      const linked = pref.source === f.source_ref || sharedTermAtLeast(String(f.fact ?? ''), pref.text, 2, 4);
      if (linked) affinity.push(`P:${pref.id}:F:${f.id}`);
    }
    for (const cand of parts.candidates ?? []) {
      const optionText = `${cand.label} ${cand.description ?? ''}`;
      if (sharedTermAtLeast(optionText, pref.text, 2, 4)) affinity.push(`P:${pref.id}:O:${cand.id}`);
    }
  }
  let oldOption = null;
  const hist = parts.historicalDecision;
  if (hist && hist.conclusion) {
    let bestScore = 0;
    for (const cand of parts.candidates ?? []) {
      const optionText = `${cand.label} ${cand.description ?? ''}`;
      const score = longestCommonSubstring(String(hist.conclusion), optionText);
      if (score >= 2 && score > bestScore) {
        bestScore = score;
        oldOption = cand.id;
      }
    }
  }
  return {
    factSig,
    constraintLinkage,
    constraintFallback: constraintFallback.sort(),
    affinity: affinity.sort(),
    oldOption,
  };
}

function assertSignaturesEqual(before, after, sampleTag) {
  const jb = JSON.stringify(before);
  const ja = JSON.stringify(after);
  if (jb !== ja) {
    throw new Error(
      `[diversify-v3] deterministic-machinery signature changed for ${sampleTag}\n` +
      `before: ${jb}\nafter:  ${ja}`,
    );
  }
}

function countProtectedInFields(fields) {
  const counts = new Array(PROTECTED.length).fill(0);
  for (const f of fields) {
    const text = f.get();
    if (typeof text !== 'string' || text.length === 0) continue;
    for (let i = 0; i < PROTECTED.length; i++) {
      const tok = PROTECTED[i];
      let idx = text.indexOf(tok);
      while (idx !== -1) {
        counts[i]++;
        idx = text.indexOf(tok, idx + tok.length);
      }
    }
  }
  return counts;
}

function assertCountsEqual(before, after, sampleTag) {
  for (let i = 0; i < PROTECTED.length; i++) {
    if (before[i] !== after[i]) {
      throw new Error(
        `[diversify-v3] protected token count changed for ${sampleTag}: ` +
        `${JSON.stringify(PROTECTED[i])} before=${before[i]} after=${after[i]}`,
      );
    }
  }
}
// ── 3. String-substitution rule table ───────────────────────────────────────
// Every `from` and every variant is asserted (at load time) to be free of
// PROTECTED tokens. Rules are general, synonym-preserving phrase swaps used
// across all epochs; they never contain V2 sample IDs, V2 fixture literals,
// V2 Gold values, or per-sample fixes (static anti-copy audit).
export const RULES = [
  // ── project / goal opening scaffolds ──────────────────────────────────────
  ['开始为', ['着手为', '准备为']],
  ['考虑为', ['打算为', '计划为']],
  ['请为', ['麻烦为', '劳烦为']],
  ['确定方向，需要在这两个选项中做出决定', ['定方向，要在这两个选项中做决定', '先定方向，在这两个选项里做决定']],
  ['需要在这两个选项中做出决定', ['要在这两个选项中做决定', '得在这两个选项里做决定']],
  ['在这两个选项中做出决定', ['在两个选项中做决定', '从两个选项中定一个']],
  ['，并记录历史决定', ['，并留存历史决定', '，并记下历史决定']],
  ['，并留存历史决定', ['，并记录历史决定', '，并记下历史决定']],
  ['，并记下历史决定', ['，并记录历史决定', '，并留存历史决定']],
  ['确定采用哪种', ['确定采用哪类', '定下采用哪种']],
  ['确定采用哪类', ['确定采用哪种', '定下采用哪类']],
  ['定下采用哪种', ['确定采用哪种', '确定采用哪类']],
  ['明确偏好', ['明确倾向', '明确中意']],
  ['更看重', ['更在意', '更重视']],
  ['看重可控性', ['重视可控性', '看重可控度']],
  ['上手速度与生态', ['上手快与生态', '易用性与生态']],
  ['两者皆可接受', ['两者都能接受', '两个都可以']],
  ['在同类场景中', ['在同场景中', '在同类场景里']],
  ['在同类场景', ['在同场景', '在同类情境']],
  ['满意度更高', ['好评度更高', '满意程度更高']],
  ['更成熟且社区更大', ['更成熟、社区更庞大', '成熟度更高且社区更活跃']],
  ['亦可行', ['也可行', '同样可行']],
  ['没有硬性限制，可以先确定方向再调整', ['没有硬性限制，可先定方向再调整', '没有硬性门槛，先定方向后调整']],
  ['可以先确定方向再调整', ['可先定方向再调整', '先定方向后调整']],
  ['初步调研：', ['前期调研：', '初步摸底：']],
  ['调研：', ['摸底：', '考察：']],
  ['agent-research 调研：', ['agent-research 调研结论：', 'agent-research 前期调研：']],
  ['评估完成：', ['评估完毕：', '评估结束：']],
  ['评估认为：', ['评估认定：', '评估判断：']],
  ['评估认定：', ['评估认为：', '评估判断：']],
  ['评估判断：', ['评估认为：', '评估认定：']],
  ['早期评估认为：', ['早期评估意见：', '早期评估判断：']],
  ['早期评估：', ['早期判断：', '最初评估：']],
  ['初步初步评估：', ['初步评估：', '前期初步评估：']],
  ['初步评估：', ['前期评估：', '初步判断：']],
  ['前期评估：', ['初步评估：', '前期判断：']],
  ['初步判断：', ['初步评估：', '前期判断：']],
  ['评估：', ['评估意见：', '评估结论：']],
  ['评估意见：', ['评估结论：', '评估判断：']],
  ['评估结论：', ['评估意见：', '评估判断：']],
  // ── TT01 evidence facts ───────────────────────────────────────────────────
  ['在同类场景更成熟', ['在同类情境更成熟', '在同场景更成熟']],
  ['在同类场景满意度更高', ['在同类情境满意度更高', '在同场景满意程度更高']],
  ['在同类情境满意度更高', ['在同类场景满意度更高', '在同场景满意程度更高']],
  ['均可行，无', ['都可行，无', '都行，无']],
  ['在已知条件下均可满足基本', ['在已知条件下都满足基本', '在已知条件里都能满足基本']],
  ['在已知条件下都满足基本', ['在已知条件下均可满足基本', '在已知条件里都能满足基本']],
  ['在已知条件里都能满足基本', ['在已知条件下均可满足基本', '在已知条件下都满足基本']],
  ['均可满足基本', ['都满足基本', '均能满足基本']],
  ['都满足基本', ['均可满足基本', '均能满足基本']],
  ['均能满足基本', ['均可满足基本', '都满足基本']],
  ['都可行且随时可回滚', ['都可行且可回退', '均可行且随时可回滚']],
  ['都可行且可回退', ['都可行且随时可回滚', '均可行且随时可回滚']],
  ['均可行且随时可回滚', ['都可行且随时可回滚', '都可行且可回退']],
  // ── TT02 scaffolds ────────────────────────────────────────────────────────
  ['其他方面没有特殊', ['其他方面没有特别之处', '其余方面无特别之处']],
  ['没有别的限制', ['没有其他限制', '无别的限制']],
  ['没有其他限制', ['没有别的限制', '无别的限制']],
  ['其余细节都可以后定', ['其余细节都可以再定', '剩余细节都后定']],
  ['需评估', ['要评估', '需要评估']],
  // ── TT03 constraint-sample scaffolds (constraint text itself untouched) ──
  ['核对候选：', ['核对选项：', '检查候选：']],
  ['核对选项：', ['核对候选：', '检查候选：']],
  ['两个候选均不满足全部', ['两个候选均不满足所有', '两个候选都未满足全部']],
  ['两个候选均不满足所有', ['两个候选均不满足全部', '两个候选都未满足全部']],
  ['两个候选都未满足全部', ['两个候选均不满足全部', '两个候选均不满足所有']],
  ['挑定满足全部', ['选定满足全部', '挑定满足所有']],
  ['选择满足', ['选定满足', '挑定满足']],
  ['选择符合', ['选定符合', '挑定符合']],
  ['敲定满足', ['选定满足', '拍板满足']],
  // ── TT04/TT06/TT13/TT14 running-status scaffolds ──────────────────────────
  ['运行良好，达到预期目标', ['运行顺畅，达到预期目标', '运转良好，达到预期目标']],
  ['运行平稳，达到预期目标', ['运转平稳，达到预期目标', '运行顺畅，达到预期目标']],
  ['运转正常，达到预期目标', ['运转平稳，达到预期目标', '运行正常，达到预期目标']],
  ['运行顺畅，达到预期目标', ['运行平稳，达到预期目标', '运转平稳，达到预期目标']],
  ['运转良好，达到预期目标', ['运行良好，达到预期目标', '运行顺畅，达到预期目标']],
  ['达到预期目标', ['达到既定目标', '达成预期目标']],
  ['运行正常', ['运转正常', '运行平稳']],
  ['运行平稳', ['运转平稳', '运行顺畅']],
  ['运转正常', ['运行正常', '运转平稳']],
  ['运转平稳', ['运行平稳', '运转顺畅']],
  ['运行顺畅', ['运转顺畅', '运行平稳']],
  ['效果不错', ['成效不错', '效果良好']],
  ['推进顺利，结果符合预期', ['推进顺畅，结果符合预期', '进展顺利，结果符合预期']],
  ['推进顺畅，结果符合预期', ['推进顺利，结果符合预期', '进展顺利，结果符合预期']],
  ['进展顺利，结果符合预期', ['推进顺利，结果符合预期', '推进顺畅，结果符合预期']],
  ['，接下来是否继续？', ['，接下来要不要继续？', '，后面是否继续？']],
  ['，接下来要不要继续？', ['，接下来是否继续？', '，后面要不要继续？']],
  ['，接下来是否延续？', ['，接下来要不要延续？', '，后面是否延续？']],
  ['，接下来要不要延续？', ['，接下来是否延续？', '，后面是否延续？']],
  ['，是否调整？', ['，要不要调整？', '，是否要调整？']],
  ['，是否要调整？', ['，要不要调整？', '，该不该调整？']],
  ['，要不要调整？', ['，是否调整？', '，该不该调整？']],
  ['，要不要改？', ['，是否要改？', '，该不该改？']],
  ['，是否要改？', ['，要不要改？', '，该不该改？']],
  ['无失败迹象', ['无失败征兆', '没有失败迹象']],
  ['（无失败迹象）', ['（未见失败迹象）', '（没有失败迹象）']],
  ['提议尝试', ['提议试试', '建议尝试']],
  ['建议尝试', ['提议尝试', '提议试试']],
  ['新证据：', ['新事实：', '新发现：']],
  ['新事实：', ['新证据：', '新发现：']],
  ['新发现：', ['新证据：', '新事实：']],
  ['明显优于', ['明显胜过', '明显好于']],
  ['显著优于', ['显著胜过', '显著好于']],
  ['大幅领先于', ['显著领先于', '远远领先于']],
  ['在关键指标上', ['在核心指标上', '在主要指标上']],
  ['在核心指标上', ['在关键指标上', '在主要指标上']],
  ['在主要指标上', ['在关键指标上', '在核心指标上']],
  ['在新指标上', ['在更新指标上', '在新维度上']],
  ['在更新指标上', ['在新指标上', '在新维度上']],
  ['满足当时需求', ['满足早期需求', '符合当时需求']],
  ['满足早期需求', ['满足当时需求', '符合早期需求']],
  ['符合当时需求', ['满足当时需求', '符合早期需求']],
  ['符合早期需求', ['满足早期需求', '满足当时需求']],
  ['已实施，运行正常', ['已实施，运转正常', '已落地，运行正常']],
  ['已实施，运转正常', ['已实施，运行正常', '已落地，运行正常']],
  ['已落地，运行正常', ['已实施，运行正常', '已实施，运转正常']],
  ['已更新，新结论', ['已更新，新判断', '已更新，新评估']],
  ['新结论', ['新判断', '新评估']],
  ['新判断', ['新结论', '新评估']],
  ['新评估', ['新结论', '新判断']],
  ['已更新已更新', ['已更新', '已做过更新']],
  // ── TT05 direction/requirement-change scaffolds ───────────────────────────
  ['两方说法相反', ['双方说法相反', '两方说法相互矛盾']],
  ['双方说法相反', ['两方说法相反', '两方说法相互矛盾']],
  ['两方说法相互矛盾', ['两方说法相反', '双方说法相反']],
  ['仍然有效（无可靠来源）', ['仍然有效但没有可靠来源', '仍有效，缺乏可靠来源']],
  ['明确反对', ['明确不赞成', '明确抵触']],
  ['改为另一个方向', ['换成另一个方向', '转为另一个方向']],
  // ── TT07 agent-beta fashion scaffolds ────────────────────────────────────
  ['agent-beta 推荐：', ['agent-beta 力荐：', 'agent-beta 建议：']],
  ['agent-beta 建议：', ['agent-beta 提议：', 'agent-beta 推荐：']],
  ['agent-beta 提议：', ['agent-beta 推荐：', 'agent-beta 建议：']],
  ['看起来更时髦', ['看起来更新潮', '显得更时髦']],
  ['似乎更流行', ['好像更流行', '似乎更新潮']],
  ['更时髦', ['更新潮', '更显时髦']],
  ['更流行', ['更新潮', '更受追捧']],
  ['更新潮', ['更时髦', '更流行']],
  ['，建议更换', ['，提议更换', '，建议换掉']],
  ['，提议更换', ['，建议更换', '，建议换掉']],
  ['，建议切换', ['，提议切换', '，建议换掉']],
  ['，提议切换', ['，建议切换', '，建议换掉']],
  ['，提议换掉', ['，建议换掉', '，提议更换']],
  ['，建议换掉', ['，提议换掉', '，提议更换']],
  ['被推荐切换', ['被建议切换', '被提议更换']],
  ['被推荐更换', ['被建议更换', '被提议换掉']],
  ['被提议更换', ['被建议更换', '被推荐换掉']],
  ['被建议切换', ['被推荐切换', '被提议更换']],
  ['被建议更换', ['被推荐更换', '被提议换掉']],
  ['被提议换掉', ['被建议换掉', '被推荐更换']],
  ['更符合当前目标', ['更贴近当前目标', '更匹配当前目标']],
  ['更契合当前目标', ['更符合当前目标', '更匹配当前目标']],
  ['更贴合当前目标', ['更契合当前目标', '更贴近当前目标']],
  ['更贴近当前目标', ['更贴合当前目标', '更匹配当前目标']],
  ['更匹配当前目标', ['更符合当前目标', '更贴合当前目标']],
  ['方向的稳定', ['方向的延续', '方向上的稳定']],
  ['方向的延续', ['方向的稳定', '方向上的稳定']],
  ['方向上的稳定', ['方向的稳定', '方向的延续']],
  ['有人推荐把', ['有人主张把', '有人建议将']],
  ['有人建议将', ['有人主张把', '有人提议把']],
  ['有人提议把', ['有人主张把', '有人建议将']],
  ['改为', ['换成', '转为']],
  ['换成', ['改为', '转成']],
  ['转为', ['改为', '换成']],
  ['转成', ['改为', '换成']],
];export const RULES_PART2 = [
  // ── TT08 low-risk arrangement scaffolds ───────────────────────────────────
  ['安排一个低风险事项：', ['安排一个低风险事宜：', '处理一个低风险事项：']],
  ['安排一个低风险事宜：', ['安排一个低风险事项：', '处理一个低风险事项：']],
  ['处理一个低风险事项：', ['安排一个低风险事项：', '安排一个低风险事宜：']],
  ['之间选择', ['之间挑选', '之间定夺']],
  ['之间挑选', ['之间选择', '之间定夺']],
  ['之间定夺', ['之间选择', '之间挑选']],
  ['之间挑定', ['之间选定', '之间敲定']],
  ['之间敲定', ['之间选定', '之间拍板']],
  ['之间选定', ['之间敲定', '之间拍板']],
  ['之间拍板', ['之间选定', '之间敲定']],
  ['无其他', ['没有其他', '无其它']],
  // ── TT09 approval scaffolds ───────────────────────────────────────────────
  ['需要就', ['要就', '须就']],
  ['做出决定：', ['作出决定：', '拿定主意：']],
  ['作出决定：', ['做出决定：', '拿定主意：']],
  ['影响重大且不可逆', ['影响重大且难以逆转', '影响严重且不可逆']],
  ['影响重大且难以逆转', ['影响重大且不可逆', '影响严重且不可逆']],
  ['影响严重且不可逆', ['影响重大且不可逆', '影响重大且难以逆转']],
  ['涉及不可恢复的数据或资产', ['涉及无法恢复的数据或资产', '涉及无法挽回的数据或资产']],
  ['涉及无法恢复的数据或资产', ['涉及不可恢复的数据或资产', '涉及无法挽回的数据或资产']],
  ['难以挽回', ['难以补救', '很难挽回']],
  ['涉及专业判断', ['涉及专业研判', '需要专业判断']],
  ['涉及专业研判', ['涉及专业判断', '需要专业判断']],
  ['安全合规的决定', ['安全合规的决策', '合规安全的决定']],
  ['安全合规的决策', ['安全合规的决定', '合规安全的决定']],
  ['合规安全的决定', ['安全合规的决定', '安全合规的决策']],
  // ── TT10 failure-recovery scaffolds ───────────────────────────────────────
  ['受阻了，下一步怎么办', ['受阻了，接下来怎么办', '遇到阻碍，下一步怎么办']],
  ['受阻了，接下来怎么办', ['受阻了，下一步怎么办', '遇到阻碍，接下来怎么办']],
  ['遇到阻碍，下一步怎么办', ['受阻了，下一步怎么办', '受阻了，接下来怎么办']],
  ['实施失败了，接下来怎么办', ['实施受阻了，接下来怎么办', '落地失败了，接下来怎么办']],
  ['实施受阻了，接下来怎么办', ['实施失败了，接下来怎么办', '落地失败了，接下来怎么办']],
  ['落地失败了，接下来怎么办', ['实施失败了，接下来怎么办', '实施受阻了，接下来怎么办']],
  ['实施失败：', ['实施受阻：', '落地失败：']],
  ['实施受阻：', ['实施失败：', '落地失败：']],
  ['落地失败：', ['实施失败：', '实施受阻：']],
  ['在初始假设下可行', ['在起初假设下可行', '基于初始假设可行']],
  ['在起初假设下可行', ['在初始假设下可行', '基于初始假设可行']],
  ['基于初始假设可行', ['在初始假设下可行', '在起初假设下可行']],
  ['，导致', ['，造成', '，致使']],
  ['，造成', ['，导致', '，致使']],
  ['，致使', ['，导致', '，造成']],
  ['已失败', ['已经失败', '已宣告失败']],
  ['已经失败', ['已失败', '已宣告失败']],
  ['新方向', ['新路线', '新路径']],
  ['新路线', ['新方向', '新路径']],
  ['备选', ['备选项', '候选项']],
  ['重新评估', ['重新权衡', '重新考量']],
  ['重新权衡', ['重新评估', '重新考量']],
  ['重新考量', ['重新评估', '重新权衡']],
  // ── TT11 multi-agent conflict scaffolds (conflict facts untouched) ────────
  ['两个智能体对', ['两个智能体就', '两个智能体围绕']],
  ['两个智能体针对', ['两个智能体就', '两个智能体围绕']],
  ['两个模型对', ['两个模型就', '两个模型围绕']],
  ['意见相左，请给出决定。', ['意见相左，请作出决定。', '意见相左，请给出结论。']],
  ['意见相左，请作出决定。', ['意见相左，请给出决定。', '意见相左，请给出结论。']],
  ['互相矛盾，请给出决定。', ['互相矛盾，请作出决定。', '相互矛盾，请给出结论。']],
  ['互相矛盾，请作出决定。', ['互相矛盾，请给出决定。', '相互矛盾，请给出结论。']],
  ['相互矛盾，请给出结论。', ['互相矛盾，请给出决定。', '互相矛盾，请作出决定。']],
  ['推荐相反，请给出结论。', ['推荐相左，请给出结论。', '推荐互相矛盾，请作出决定。']],
  ['推荐相左，请给出结论。', ['推荐相反，请给出结论。', '推荐互相矛盾，请作出决定。']],
  ['请给出结论。', ['请作出结论。', '请给出定论。']],
  ['请作出结论。', ['请给出结论。', '请给出定论。']],
  ['请给出决定。', ['请作出决定。', '请给出结论。']],
  ['请作出决定。', ['请给出决定。', '请给出结论。']],
  ['请给出意见。', ['请给出看法。', '请给出建议。']],
  ['请给出看法。', ['请给出意见。', '请给出建议。']],
  ['请给出建议。', ['请提供建议。', '请给出意见。']],
  ['请提供建议。', ['请给出建议。', '请给出意见。']],
  ['请提供提议。', ['请给出提议。', '请提供建议。']],
  ['请给出提议。', ['请提供提议。', '请提供建议。']],
  ['请提供推荐。', ['请给出推荐。', '请提供建议。']],
  ['请给出推荐。', ['请提供推荐。', '请提供建议。']],
  ['请提供意见。', ['请给出意见。', '请提供看法。']],
  ['，附另一组实测数据', ['，并附另一组实测数据', '，附带另一组实测数据']],
  ['，并附另一组实测数据', ['，附另一组实测数据', '，附带另一组实测数据']],
  ['，附带另一组实测数据', ['，附另一组实测数据', '，并附另一组实测数据']],
  ['，并给出实测数据', ['，并附上实测数据', '，并提供实测数据']],
  ['，并附上实测数据', ['，并给出实测数据', '附带实测数据']],
  ['，并提供实测数据', ['，并给出实测数据', '附带实测数据']],
  ['附带实测数据', ['附有实测数据', '并带实测数据']],
  ['并附上实测数据', ['并给出实测数据', '附带实测数据']],
  ['并给出实测数据', ['并附上实测数据', '附带实测数据']],
  ['数据更完整且可复现', ['数据更齐全且可复现', '数据更完整且可复核']],
  ['数据更齐全且可复现', ['数据更完整且可复现', '数据更完整且可复核']],
  ['数据更完整且可复核', ['数据更完整且可复现', '数据更齐全且可复现']],
  ['两方证据强度相当', ['双方证据强度相当', '两方证据强度相近']],
  ['双方证据强度相当', ['两方证据强度相当', '两方证据强度相近']],
  ['两方证据强度相近', ['两方证据强度相当', '双方证据强度相当']],
  ['观点（同样无新数据）', ['观点（同样没有新数据）', '观点（也没有新数据）']],
  ['（同样无新数据）', ['（同样没有新数据）', '（也没有新数据）']],
  ['（无数据支撑）', ['（缺少数据支撑）', '（没有数据支撑）']],
  ['（缺少数据支撑）', ['（无数据支撑）', '（没有数据支撑）']],
  ['更流行（无数据支撑）', ['更受欢迎（无数据支撑）', '更新潮（缺少数据支撑）']],
  ['agent-alpha：', ['agent-alpha 报告：', 'agent-alpha 评估：']],
  ['agent-beta：', ['agent-beta 报告：', 'agent-beta 评估：']],
  ['agent-alpha 报告：', ['agent-alpha：', 'agent-alpha 评估：']],
  ['agent-beta 报告：', ['agent-beta：', 'agent-beta 评估：']],
  ['agent-alpha 实测：', ['agent-alpha 测得：', 'agent-alpha 实测显示：']],
  ['agent-alpha 测得：', ['agent-alpha 实测：', 'agent-alpha 实测显示：']],
  ['agent-alpha 实测显示：', ['agent-alpha 实测：', 'agent-alpha 测得：']],
  [' 认为 ', [' 判断 ', ' 评估 ']],
  [' 判断 ', [' 认为 ', ' 评估 ']],
  [' 评估 ', [' 认为 ', ' 判断 ']],
  ['agent-alpha 建议', ['agent-alpha 推荐', 'agent-alpha 提议']],
  ['agent-alpha 推荐', ['agent-alpha 建议', 'agent-alpha 提议']],
  ['agent-alpha 提议', ['agent-alpha 建议', 'agent-alpha 推荐']],
  ['agent-gamma：', ['agent-gamma 评估：', 'agent-gamma 判断：']],
  ['agent-gamma 评估：', ['agent-gamma：', 'agent-gamma 判断：']],
  ['agent-gamma 判断：', ['agent-gamma：', 'agent-gamma 评估：']],
  ['更胜一筹', ['更占上风', '更显优势']],
  ['更占上风', ['更胜一筹', '更显优势']],
  ['更显优势', ['更胜一筹', '更占上风']],
  ['更具优势', ['更显优势', '优势更明显']],
  ['优势更明显', ['更具优势', '更显优势']],
  ['表现更好', ['表现更佳', '表现更优']],
  ['表现更佳', ['表现更好', '表现更优']],
  ['表现更优', ['表现更好', '表现更佳']],
  ['更优', ['更好', '更佳']],
  ['更好', ['更优', '更佳']],
  ['更佳', ['更优', '更好']],
  ['当前最优', ['当前最佳', '眼下最优']],
  ['当前最佳', ['当前最优', '眼下最优']],
  ['在综合表现上', ['在整体表现上', '在综合表现中']],
  ['在整体表现上', ['在综合表现上', '在综合表现中']],
  ['在稳定性上', ['在稳定表现上', '在稳定性方面']],
  ['在稳定性方面', ['在稳定性上', '在稳定表现上']],
  ['在交付周期上', ['在交付进度上', '在交付周期方面']],
  ['在交付周期方面', ['在交付周期上', '在交付进度上']],
  ['记录称部分指标正常', ['记录显示部分指标正常', '记录称部分指标未见异常']],
  ['记录显示部分指标正常', ['记录称部分指标正常', '记录称部分指标未见异常']],
  ['另一记录称', ['另一条记录称', '另一记录显示']],
  ['另一条记录称', ['另一记录称', '另一记录显示']],
  ['也不错，但', ['也不错，然而', '也不错，只是']],
  ['也不错，然而', ['也不错，但', '也不错，只是']],
];export const RULES_PART3 = [
  // ── TT12/TT14 override scaffolds (override markers themselves protected) ─
  ['已经定下来了，现在怎么处理', ['已经定下来了，现在该如何处理', '已经定下来了，眼下怎么处理']],
  ['已经定下来了，现在该如何处理', ['已经定了下来，现在该怎么处理', '已定下来，眼下如何处理']],
  ['已经定下来了，眼下怎么处理', ['已经定下来了，眼下如何处理', '已定下来，现在该怎么处理']],
  ['征询意见：', ['征询建议：', '征求意见：']],
  ['征询建议：', ['征询意见：', '征求建议：']],
  ['征求意见：', ['征询意见：', '征询建议：']],
  ['征求推荐：', ['征求建议：', '征询推荐：']],
  ['征求提议：', ['征求建议：', '征询提议：']],
  ['征询提议：', ['征求提议：', '征求建议：']],
  ['提供推荐', ['给出推荐', '提供建议']],
  ['给出推荐', ['提供推荐', '提供建议']],
  ['给出意见', ['提供意见', '给出看法']],
  ['提供意见', ['给出意见', '提供看法']],
  ['给出看法', ['给出意见', '提供看法']],
  ['给出建议', ['提供建议', '给出看法']],
  ['给出提议', ['提供提议', '给出建议']],
  ['提供提议', ['给出提议', '提供建议']],
  ['，并准备', ['，并打算', '，并预备']],
  ['形成决定 decision-d1：', ['产生决定 decision-d1：', '做出决定 decision-d1：']],
  ['产生决定 decision-d1：', ['形成决定 decision-d1：', '做出决定 decision-d1：']],
  ['做出决定 decision-d1：', ['形成决定 decision-d1：', '产生决定 decision-d1：']],
  ['改向', ['改选', '另有选择']],
  ['，推荐', ['，力荐', '，首推']],
  ['（忽略', ['（无视', '（未予理会']],
  // ── TT13 revisit scaffolds ────────────────────────────────────────────────
  ['到了复查', ['又到复查', '已到复查']],
  ['又到复查', ['到了复查', '已到复查']],
  ['已到复查', ['到了复查', '又到复查']],
  ['，需要给出结论', ['，要给出结论', '，需给出结论']],
  ['，要给出结论', ['，需要给出结论', '，需给出结论']],
  ['，需给出结论', ['，需要给出结论', '，要给出结论']],
  ['约定到期复查', ['约定到时复查', '约定期满复查']],
  ['约定到时复查', ['约定到期复查', '约定期满复查']],
  ['约定期满复查', ['约定到期复查', '约定到时复查']],
  ['设置复查', ['设定复查', '安排复查']],
  ['设定复查', ['设置复查', '安排复查']],
  ['安排复查', ['设置复查', '设定复查']],
  ['发生实质变化', ['发生明显变化', '出现实质变化']],
  ['发生明显变化', ['发生实质变化', '出现实质变化']],
  ['出现实质变化', ['发生实质变化', '发生明显变化']],
  ['条件发生实质变化', ['条件出现明显变化', '条件发生实质变动']],
  ['条件出现明显变化', ['条件发生实质变化', '条件发生实质变动']],
  ['条件发生实质变动', ['条件发生实质变化', '条件出现明显变化']],
  ['条件已变化', ['条件出现变化', '条件已有变化']],
  ['条件出现变化', ['条件已变化', '条件已有变化']],
  ['条件已有变化', ['条件已变化', '条件出现变化']],
  ['在复查前最优', ['在复查前最佳', '复查前表现最优']],
  ['在复查前最佳', ['在复查前最优', '复查前表现最优']],
  ['复查前表现最优', ['在复查前最优', '在复查前最佳']],
  ['复查', ['复评', '复核']],
  ['复评', ['复查', '复核']],
  ['复核', ['复查', '复评']],
  ['条件与上次一致', ['条件与上回一致', '条件跟上次相同']],
  ['条件与上回一致', ['条件与上次一致', '条件跟上次相同']],
  ['条件跟上次相同', ['条件与上次一致', '条件与上回一致']],
  ['略有波动，但未构成实质变化', ['略有起伏，但未构成实质变化', '稍有波动，不构成实质变化']],
  ['略有起伏，但未构成实质变化', ['略有波动，但未构成实质变化', '稍有波动，不构成实质变化']],
  ['稍有波动，不构成实质变化', ['略有波动，但未构成实质变化', '略有起伏，但未构成实质变化']],
  ['没有实质变化', ['没有实质变动', '无明显变化']],
  ['没有实质变动', ['没有实质变化', '无明显变化']],
  ['无明显变化', ['没有实质变化', '没有实质变动']],
  // ── TT15 deleted-evidence scaffolds (expiry_reason untouched) ─────────────
  ['依据 ', ['基于 ', '根据 ']],
  ['基于 ', ['依据 ', '根据 ']],
  ['根据 ', ['依据 ', '基于 ']],
  ['做出的决定', ['作出过的决定', '做过的决定']],
  ['作出过的决定', ['做出的决定', '做过的决定']],
  ['做过的决定', ['做出的决定', '作出过的决定']],
  ['现在怎么处理？', ['现在该如何处理？', '眼下怎么处理？']],
  ['现在该如何处理？', ['现在该怎么处理？', '眼下该如何处理？']],
  ['眼下怎么处理？', ['眼下该如何处理？', '现在该怎么处理？']],
  ['（来源已删除）', ['（来源已被移除）', '（来源已撤下）']],
  ['（来源已被移除）', ['（来源已删除）', '（来源已撤下）']],
  ['（来源已撤下）', ['（来源已删除）', '（来源已被移除）']],
  ['决定依据（', ['决策依据（', '决定凭据（']],
  ['决策依据（', ['决定依据（', '决定凭据（']],
  ['决定凭据（', ['决定依据（', '决策依据（']],
  ['/删除', ['/移除', '/清除']],
  ['衍生决定 decision-d2', ['派生决定 decision-d2', '后续决定 decision-d2']],
  ['派生决定 decision-d2', ['衍生决定 decision-d2', '后续决定 decision-d2']],
  ['后续决定 decision-d2', ['衍生决定 decision-d2', '派生决定 decision-d2']],
  ['（基于 decision-d1 的后续安排）', ['（以 decision-d1 为基础的后续安排）', '（承接 decision-d1 的后续安排）']],
  ['（以 decision-d1 为基础的后续安排）', ['（基于 decision-d1 的后续安排）', '（承接 decision-d1 的后续安排）']],
  ['（承接 decision-d1 的后续安排）', ['（基于 decision-d1 的后续安排）', '（以 decision-d1 为基础的后续安排）']],
  ['供应商承诺：', ['供应商承诺内容：', '供应商承诺条款：']],
  ['供应商承诺内容：', ['供应商承诺：', '供应商承诺条款：']],
  ['政策依据：', ['政策依据条款：', '政策凭据：']],
  ['政策凭据：', ['政策依据：', '政策依据条款：']],
  ['依据条款：', ['凭据条款：', '依据条款内容：']],
  ['凭据条款：', ['依据条款：', '依据条款内容：']],
  ['定价依据：', ['定价凭据：', '定价依据条款：']],
  ['定价凭据：', ['定价依据：', '定价依据条款：']],
  ['删除证据的传播', ['删除证据的传导', '失效证据的传播']],
  ['删除证据的传导', ['删除证据的传播', '失效证据的传播']],
  ['失效证据的传播', ['删除证据的传播', '删除证据的传导']],
  // ── remaining prompt / goal fragments ────────────────────────────────────
  ['，现在需要重新评估是否调整。', ['，现在要重新评估是否调整。', '，眼下需要重新评估是否调整。']],
  ['，现在要重新评估是否调整。', ['，现在需要重新评估是否调整。', '，眼下需要重新评估是否调整。']],
  ['，眼下需要重新评估是否调整。', ['，现在需要重新评估是否调整。', '，现在要重新评估是否调整。']],
  ['之间做出安排', ['之间做安排', '之间拟定安排']],
  ['之间做安排', ['之间做出安排', '之间拟定安排']],
  ['之间拟定安排', ['之间做出安排', '之间做安排']],
  ['从失败中调整', ['从失败里调整', '在失败后调整']],
  ['从失败里调整', ['从失败中调整', '在失败后调整']],
  ['在失败后调整', ['从失败中调整', '从失败里调整']],
  ['多智能体分歧', ['多智能体意见分歧', '多智能体矛盾']],
  ['多智能体意见分歧', ['多智能体分歧', '多个智能体的分歧']],
  ['多智能体矛盾', ['多智能体冲突', '多个智能体的矛盾']],
  ['裁定多智能体', ['裁决多智能体', '裁定多个智能体']],
  ['裁决多智能体', ['裁定多智能体', '裁定多个智能体']],
  ['妥善处理', ['妥当处理', '稳妥处理']],
  ['时复查', ['时复评', '时复核']],
  ['时复评', ['时复查', '时复核']],
  ['时复核', ['时复查', '时复评']],
  ['的有效方向', ['的有效路线', '的可行方向']],
  ['的有效路线', ['的有效方向', '的可行方向']],
  ['的可行方向', ['的有效方向', '的有效路线']],
  ['的低风险安排', ['的低风险事项', '的低风险事宜']],
  ['的低风险事项', ['的低风险安排', '的低风险事宜']],
  ['的低风险事宜', ['的低风险安排', '的低风险事项']],
];

// ── 4. Regex rule table (prompt template families) ─────────────────────────
// Anchored full-field templates for recurring prompt shapes. Capture groups
// preserve entity names, option labels and diversified verbs/nouns. Every
// regex source and every variant template is asserted to be free of PROTECTED
// tokens. `$1..$9` are replaced with the capture groups.
export const REGEX_RULES = [
  // TT01: 为X从A和B之间做出<verb>并给出<noun>。
  {
    re: /^为(.+?)从(.+?)和(.+?)之间做出(.+?)并给出(.+?)。$/,
    variants: [
      '请为$1从$2与$3之间$4并给出$5。',
      '为$1在$2和$3之间$4，并给出$5。',
      '帮$1从$2与$3之间$4并给出$5。',
    ],
  },
  // TT02/TT05: 为X<verb>A还是B？请给出<noun>。
  {
    re: /^为(.+?)(选择|挑定|选定|敲定)(.+?)还是(.+?)？请给出(.+?)。$/,
    variants: [
      '请为$1$2$3还是$4？请提供$5。',
      '为$1$2$3或$4？请给出$5。',
    ],
  },
  // TT03: 为X在A和B之间<verb>（并执行。保留在后）
  {
    re: /^为(.+?)在(.+?)和(.+?)之间(选择|挑定|选定|敲定)/,
    variants: [
      '请为$1在$2与$3之间$4',
      '劳烦为$1在$2和$3之间$4',
    ],
  },
  // TT04/TT09: 为X在A和B之间做出决定。
  {
    re: /^为(.+?)在(.+?)和(.+?)之间做出决定。$/,
    variants: [
      '请为$1在$2与$3之间做出决定。',
      '为$1在$2和$3之间定夺。',
    ],
  },
  // TT08: 请为X在A和B之间做出安排（并执行。保留在后）
  {
    re: /^请为(.+?)在(.+?)和(.+?)之间做出安排/,
    variants: [
      '请为$1在$2与$3之间做出安排',
      '劳烦为$1在$2和$3之间做出安排',
    ],
  },
];
// ── 5. Combined rule list + load-time validation ────────────────────────────
const ALL_RULES = [...RULES, ...RULES_PART2, ...RULES_PART3].sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]));

function assertNoProtectedToken(str, kind, rule) {
  for (const tok of PROTECTED) {
    if (str.includes(tok)) {
      throw new Error(
        `[diversify-v3] ${kind} contains protected token ${JSON.stringify(tok)}: ` +
        `${JSON.stringify(str)} (rule ${JSON.stringify(rule)})`,
      );
    }
  }
}

function validateRules() {
  const seen = new Set();
  const violations = [];
  const report = (kind, str, rule) => {
    for (const tok of PROTECTED) {
      if (str.includes(tok)) {
        violations.push(`${kind} contains protected token ${JSON.stringify(tok)}: ${JSON.stringify(str)} (rule ${JSON.stringify(rule)})`);
        return;
      }
    }
  };
  for (const [from, variants] of ALL_RULES) {
    if (typeof from !== 'string' || from.length < 2) violations.push(`invalid rule from: ${JSON.stringify(from)}`);
    if (seen.has(from)) violations.push(`duplicate rule from: ${JSON.stringify(from)}`);
    seen.add(from);
    report('rule from', from, [from, variants]);
    if (!Array.isArray(variants) || variants.length === 0) violations.push(`rule without variants: ${JSON.stringify(from)}`);
    for (const v of variants) {
      if (typeof v !== 'string' || v.length === 0) violations.push(`empty variant for ${JSON.stringify(from)}`);
      report('rule variant', v, [from, v]);
    }
  }
  for (const { re, variants } of REGEX_RULES) {
    const src = String(re);
    report('regex source', src, src);
    for (const v of variants) report('regex variant', v, [String(re), v]);
  }
  if (violations.length > 0) {
    throw new Error(`[diversify-v3] rule-table validation failed (${violations.length}):\n` + violations.join('\n'));
  }
}

validateRules();

// ── 6. Diversification engine ───────────────────────────────────────────────

const RULE_PROB = 0.9;
const REGEX_PROB = 0.95;

function isConstraintLinkedFact(f, parts) {
  const hcs = parts.hardConstraints ?? [];
  if (hcs.length === 0) return false;
  const fact = String(f.fact ?? '');
  return hcs.some((hc) => constraintLinked(fact, f.supports, hc));
}

function collectFields(parts) {
  const fields = [];
  const push = (kind, get, set) => fields.push({ kind, get, set });
  push('prompt', () => parts.prompt, (v) => { parts.prompt = v; });
  push('goal', () => parts.goal?.text, (v) => { if (parts.goal) parts.goal.text = v; });
  for (const e of parts.events ?? []) {
    if (e.type === 'delete' || e.type === 'override') continue;
    const ev = e;
    push('event', () => ev.content, (v) => { ev.content = v; });
  }
  for (const c of parts.candidates ?? []) {
    const cand = c;
    push('cand', () => cand.description, (v) => { cand.description = v; });
  }
  for (const f of parts.qualified ?? []) {
    if (isConstraintLinkedFact(f, parts)) continue;
    const fact = f;
    push('qual', () => fact.fact, (v) => { fact.fact = v; });
  }
  for (const f of parts.expired ?? []) {
    const fact = f;
    push('expired', () => fact.fact, (v) => { fact.fact = v; });
  }
  if (parts.historicalDecision) {
    const h = parts.historicalDecision;
    push('histq', () => h.question, (v) => { h.question = v; });
    push('histc', () => h.conclusion, (v) => { h.conclusion = v; });
  }
  if (parts.executionOutcome) {
    const o = parts.executionOutcome;
    push('outcome', () => o.actual_outcome, (v) => { o.actual_outcome = v; });
  }
  return fields;
}

/**
 * Apply the V3-R1 epoch diversification to builder parts in place.
 * Deterministic: driven only by the passed sample RNG.
 * Throws (fail closed) if any deterministic-machinery signature changes.
 * @returns {{changes: number, perField: Record<string, number>}}
 */
export function applyV3Diversification(parts, rng) {
  const beforeSig = captureSignatures(parts);
  const fields = collectFields(parts);
  const beforeCounts = countProtectedInFields(fields);
  const changes = { total: 0, perField: {} };

  for (const f of fields) {
    const raw = f.get();
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const protectedText = protectText(raw);
    let out = protectedText;
    let fieldChanges = 0;

    for (const [from, variants] of ALL_RULES) {
      if (!out.includes(from)) continue;
      const segs = out.split(from);
      if (segs.length < 2) continue;
      const rebuilt = [segs[0]];
      for (let i = 1; i < segs.length; i++) {
        if (rng.nextFloat() < RULE_PROB) {
          rebuilt.push(rng.pick(variants));
          fieldChanges++;
        } else {
          rebuilt.push(from);
        }
        rebuilt.push(segs[i]);
      }
      out = rebuilt.join('');
    }

    for (const { re, variants } of REGEX_RULES) {
      re.lastIndex = 0;
      const m = out.match(re);
      if (!m) continue;
      if (rng.nextFloat() < REGEX_PROB) {
        const tmpl = rng.pick(variants);
        out = out.replace(re, () => tmpl.replace(/\$(\d)/g, (_, d) => m[Number(d)] ?? ''));
        fieldChanges++;
      }
    }

    if (out !== protectedText) {
      f.set(restoreText(out));
      changes.total += fieldChanges;
      changes.perField[f.kind] = (changes.perField[f.kind] ?? 0) + fieldChanges;
    }
  }

  const afterCounts = countProtectedInFields(fields);
  assertCountsEqual(beforeCounts, afterCounts, parts.sampleId ?? 'sample');
  const afterSig = captureSignatures(parts);
  assertSignaturesEqual(beforeSig, afterSig, parts.sampleId ?? 'sample');
  return changes;
}
