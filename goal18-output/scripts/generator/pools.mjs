// Domain + entity pools for Goal 18 v2 generator.
// Split isolation: entity names are composed as `prefix + domainNoun` where the prefix
// pool is disjoint between validation and holdback, guaranteeing disjoint name strings.
// All content is synthetic; no real user data.

export const VAL_PREFIXES = ['青岚', '墨渊', '黛眉', '湛露', '霜华', '霁月', '沧浪', '素商', '玄霜', '绯樱', '绛雪', '碧梧', '琉光', '皓月', '晖晨', '泓澄', '漪澜', '汐语', '岫云', '澄明', '濯缨', '泮水', '洙泗', '潇湘'];
export const HB_PREFIXES = ['屿汀', '岑寂', '渚清', '崧岳', '岵峰', '岐山', '峦翠', '嶂云', '嵋岭', '汶水', '涪江', '洄游', '沂源', '涔雨', '渌水', '渲江', '湄洲', '沣水', '泗滨', '澧水', '滁州', '濠河', '澉浦', '濮水'];

// Domain definitions. `primary`/`alt` are 2-3 char nouns used to build entity names.
// `pairs` is a list of pair-groups; each pair-group holds concrete option-pair strings.
// `people` are stakeholder role names; `highRisk` domains only allow approval/refusal/referral golds.
export const DOMAINS = [
  {
    id: 'software-dev', label: '软件项目开发', highRisk: false,
    primary: ['笔记', '图床', '阅读器', '记账', '短链', '知识库', '博客', '相册'],
    alt: ['部署', '重构', '迁移', '升级', '模块化', '性能优化', '安全加固', '自动化'],
    pairs: [
      [['自建开源方案', '付费托管方案'], ['本地部署', '云服务'], ['按月订阅', '一次买断']],
      [['国内云', '海外云'], ['单体架构', '微服务架构'], ['自有域名', '平台子域名']]
    ],
    people: ['同事', '合伙人', '外包团队', '运维同学']
  },
  {
    id: 'learning-courses', label: '学习与课程安排', highRisk: false,
    primary: ['线性代数', '概率统计', '数据结构', '操作系统', '编译原理', '网络协议', '数据库', '机器学习'],
    alt: ['习题课', '慕课', '实验课', '读书会', '集训营', '答疑', '笔记整理', '刷题'],
    pairs: [
      [['周末面授班', '录播自学'], ['线下集训', '线上陪跑'], ['跟班学习', '自定节奏']],
      [['先修基础', '直接进阶'], ['中文教材', '英文原版'], ['跟教程', '跟项目']]
    ],
    people: ['导师', '助教', '同学', '学长']
  },
  {
    id: 'career-job-search', label: '求职与职业选择', highRisk: false,
    primary: ['前端开发', '数据分析', '产品运营', '后端开发', '测试开发', '游戏策划', '视觉设计', '项目经理'],
    alt: ['简历', '作品集', '内推', '面试', '试用期', '转正', '跳槽', '副业'],
    pairs: [
      [['大厂稳定岗', '创业公司核心岗'], ['远程办公', '坐班'], ['现金为王', '期权为主']],
      [['先接小单试水', '直接投全职'], ['跟猎头', '自己投递'], ['先实习', '直接面试']]
    ],
    people: ['猎头', 'HR', '前同事', '导师']
  },
  {
    id: 'schedule-time', label: '日程和时间分配', highRisk: false,
    primary: ['晨跑', '读书', '健身', '冥想', '写作', '学英语', '编程练习', '复盘'],
    alt: ['通勤', '午休', '周末', '出差', '假期', '加班', '家务', '社交'],
    pairs: [
      [['固定时段', '弹性时段'], ['早起执行', '晚间执行'], ['每天短时', '每周集中']],
      [['工作日推进', '周末补量'], ['先运动后学习', '先学习后运动'], ['拆成小块', '整块时间']]
    ],
    people: ['家人', '室友', '教练', '朋友']
  },
  {
    id: 'privacy-device', label: '隐私与设备设置', highRisk: false,
    primary: ['路由器', 'NAS', '智能音箱', '摄像头', '手机', '笔记本', '手表', '云盘'],
    alt: ['指纹', '人脸', '两步验证', '访客网络', '备份', '抹除', '定位', '通知'],
    pairs: [
      [['开两步验证', '只设强密码'], ['本地加密', '云端同步'], ['访客网络', '主网络共享']],
      [['自动备份', '手动备份'], ['允许定位', '关闭定位'], ['更新到最新版', '暂缓更新']]
    ],
    people: ['家人', '合租室友', '维修师傅', '客服']
  },
  {
    id: 'purchase-budget', label: '采购与预算', highRisk: false,
    primary: ['显示器', '机械键盘', '人体工学椅', '降噪耳机', '相机', '平板', '扫地机器人', '电动牙刷'],
    alt: ['分期', '二手', '团购', '以旧换新', '国补', '返现', '延保', '配件'],
    pairs: [
      [['全新国行', '二手水货'], ['官方渠道', '第三方渠道'], ['顶配', '基础款']],
      [['立刻买', '等促销'], ['一次性付清', '分十二期'], ['买新款', '买旧款']]
    ],
    people: ['伴侣', '室友', '朋友', '卖家']
  },
  {
    id: 'travel-planning', label: '旅行规划', highRisk: false,
    primary: ['云南', '川西', '厦门', '青岛', '京都', '大阪', '首尔', '曼谷'],
    alt: ['机票', '酒店', '签证', '保险', '租车', '跟团', '自由行', '攻略'],
    pairs: [
      [['跟团游', '自由行'], ['直飞', '中转'], ['住市区', '住机场附近']],
      [['旺季出行', '淡季出行'], ['四天三晚', '七天六晚'], ['租车自驾', '公共交通']]
    ],
    people: ['旅伴', '地接', '房东', '领队']
  },
  {
    id: 'team-collaboration', label: '团队协作', highRisk: false,
    primary: ['周报', '看板', '文档库', '会议', '知识库', '评审会', 'OKR', '值班表'],
    alt: ['同步', '复盘', '分工', '排期', '权限', '归档', '模板', '通知'],
    pairs: [
      [['全员同步', '按需异步'], ['集中评审', '分头自查'], ['统一模板', '自由格式']],
      [['每周例会', '双周例会'], ['文档先行', '会上讨论'], ['内部工具', '公共平台']]
    ],
    people: ['组长', '产品经理', '设计师', '新人']
  },
  {
    id: 'content-publishing', label: '内容创作和发布', highRisk: false,
    primary: ['公众号', '播客', 'B站', '小红书', '抖音', '知乎', 'Newsletter', 'YouTube'],
    alt: ['选题', '脚本', '剪辑', '封面', '发布时间', '评论区', '合作', '变现'],
    pairs: [
      [['日更', '周更'], ['图文', '视频'], ['先发平台', '自建站首发']],
      [['蹭热点', '做长线选题'], ['真人出镜', '纯剪辑'], ['免费公开', '付费订阅']]
    ],
    people: ['编辑', '运营搭档', '粉丝群', '商务']
  },
  {
    id: 'longterm-project', label: '长期项目管理', highRisk: false,
    primary: ['开源库', '家庭档案', '学琴计划', '花园改造', '书稿', '投资组合', '语言学习', '社区项目'],
    alt: ['里程碑', '预算', '风险', '复盘', '招募', '节奏', '范围', '存档'],
    pairs: [
      [['快节奏小步', '慢节奏深耕'], ['个人主导', '团队共管'], ['公开进展', '内部推进']],
      [['先立里程碑', '先跑通流程'], ['季度复盘', '月度复盘'], ['扩大范围', '收敛范围']]
    ],
    people: ['伙伴', '资助人', '顾问', '社区成员']
  },
  {
    id: 'health-lifestyle', label: '低风险健康生活安排', highRisk: false,
    primary: ['睡眠', '饮食', '运动', '饮水', '护眼', '久坐', '体检', '作息'],
    alt: ['食谱', '拉伸', '午休', '步数', '体重', '血压', '心率', '情绪'],
    pairs: [
      [['晨间运动', '晚间运动'], ['控糖饮食', '均衡饮食'], ['固定就寝', '弹性就寝']],
      [['每周三次', '每天坚持'], ['自己做饭', '外卖搭配'], ['循序渐进', '一步到位']]
    ],
    people: ['家人', '医生', '朋友', '健身教练']
  },
  {
    id: 'files-knowledge', label: '文件和知识管理', highRisk: false,
    primary: ['笔记库', '标签体系', '归档规则', '网盘', '邮件', '剪藏', '双链', '版本备份'],
    alt: ['命名', '同步', '索引', '去重', '权限', '回收站', '模板', '检索'],
    pairs: [
      [['本地优先', '云端优先'], ['单一入口', '多入口'], ['手动归档', '自动归档']],
      [['按主题组织', '按时间组织'], ['保留全部', '定期清理'], ['公开共享', '私有隔离']]
    ],
    people: ['家人', '同事', '搭档', '托管服务商']
  },
  {
    id: 'medical-care', label: '医疗健康（高风险，仅审批/转介类）', highRisk: true,
    primary: ['体检报告', '用药', '手术', '复诊', '疫苗', '牙科', '眼科', '慢病管理'],
    alt: ['化验单', '医嘱', '转诊', '影像', '处方', '随访', '保险理赔', '第二诊疗意见'],
    pairs: [
      [['预约专科门诊', '继续家庭医生随访'], ['按医嘱执行', '自行调整'], ['线下复诊', '线上问诊']],
      [['申请转诊', '维持现状'], ['住院治疗', '门诊治疗'], ['采纳建议', '暂不采纳']]
    ],
    people: ['主治医生', '家属', '药剂师', '保险公司']
  },
  {
    id: 'legal-matters', label: '法律事务（高风险，仅审批/转介类）', highRisk: true,
    primary: ['合同', '租房协议', '劳动仲裁', '遗产安排', '商标', '隐私条款', '纠纷', '公证'],
    alt: ['律师函', '调解', '证据保全', '备案', '授权书', '合规', '仲裁', '诉讼'],
    pairs: [
      [['委托律师处理', '自行协商'], ['签署协议', '暂缓签署'], ['走仲裁', '走调解']],
      [['聘请常年顾问', '按件委托'], ['公证备案', '私下约定'], ['先咨询再行动', '直接行动']]
    ],
    people: ['律师', '对方当事人', '公证员', '仲裁员']
  },
  {
    id: 'financial-planning', label: '金融规划（高风险，仅审批/转介类）', highRisk: true,
    primary: ['基金', '保险', '贷款', '公积金', '退税', '外币', '债券', '定投'],
    alt: ['收益率', '风险等级', '赎回', '费率', '征信', '额度', '期限', '对冲'],
    pairs: [
      [['咨询持牌顾问', '自己研究'], ['配置稳健组合', '追求高收益'], ['短期产品', '长期产品']],
      [['先还贷', '先投资'], ['一次性投入', '分批定投'], ['境内配置', '跨境配置']]
    ],
    people: ['理财顾问', '银行经理', '家人', '税务师']
  },
  {
    id: 'home-living', label: '家居生活', highRisk: false,
    primary: ['家具', '家电', '收纳', '绿植', '清洁', '改造', '维修', '租约'],
    alt: ['采光', '动线', '收纳', '预算', '邻居', '物业', '快递', '搬家公司'],
    pairs: [
      [['自己动手', '请师傅'], ['整屋焕新', '局部改造'], ['买新家具', '二手家具']],
      [['长租续约', '换房'], ['周末施工', '集中施工'], ['先量尺寸', '先定风格']]
    ],
    people: ['家人', '房东', '物业', '师傅']
  },
  {
    id: 'community-events', label: '社区活动', highRisk: false,
    primary: ['读书会', '市集', '讲座', '跑团', '摄影展', '募捐', '旧物交换', '工作坊'],
    alt: ['场地', '报名', '宣传', '物资', '赞助', '排期', '志愿者', '复盘'],
    pairs: [
      [['线上举办', '线下举办'], ['收费入场', '免费开放'], ['每周一次', '每月一次']],
      [['自办', '联合主办'], ['先报名后定内容', '先定内容后报名'], ['大场地', '小场地']]
    ],
    people: ['组织者', '志愿者', '参与者', '赞助方']
  }
];

export const TASK_TYPE_LABELS = {
  TT01: '信息充分二选一', TT02: '缺失关键变量', TT03: '硬约束违反',
  TT04: '旧事实过期', TT05: '多来源冲突', TT06: '新证据推翻旧决定',
  TT07: '新证据不足推翻', TT08: '低风险可逆', TT09: '高风险不可逆',
  TT10: '执行失败后修订', TT11: '结果良好后延续', TT12: '多Agent建议冲突',
  TT13: '用户主动覆盖', TT14: '到达revisit_at', TT15: '删除证据失效传播'
};

// Deterministic option-pair selection: different (task, idx) => different pair group,
// which guarantees same-task samples across splits use different option labels.
export function pickPair(rng, d, ctx) {
  const allPairs = d.pairs.flat();
  if (ctx.epoch === 'v3') {
    // V3-R1 seed-aware option-surface realization: the pair-group is drawn from the
    // slot-local RNG so different epochs realize the same (tt, idx) slot with a
    // different option surface. Construct semantics unchanged (same pair pools).
    return allPairs[rng.int(allPairs.length)];
  }
  const n = Number(ctx.tt.slice(2)) + ctx.idx;
  return allPairs[n % allPairs.length];
}

export function prefixesFor(splitTag) {
  return splitTag === 'val' ? VAL_PREFIXES : HB_PREFIXES;
}

export function domainById(id) {
  return DOMAINS.find((d) => d.id === id);
}

// Pick a set of distinct entity names for a sample.
// `count` names from role words; returns array of {key, name} where key = role label.
export function pickEntities(rng, domain, roleWords, count, tag) {
  const prefixes = prefixesFor(tag);
  const words = rng.pickMany(roleWords, count);
  const used = new Set();
  const out = [];
  let guard = 0;
  for (const w of words) {
    let name = null;
    let tries = 0;
    while (!name || used.has(name)) {
      name = rng.pick(prefixes) + w;
      tries++;
      if (tries > 50) break;
    }
    used.add(name);
    out.push(name);
  }
  return out;
}
