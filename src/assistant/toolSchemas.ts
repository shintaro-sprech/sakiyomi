import type Anthropic from '@anthropic-ai/sdk'

// Tools Claude can call. The Worker sends these definitions; the browser runs them (tools.ts).
export const TOOL_NAMES = {
  getSituation: 'get_situation',
  getOrderPlan: 'get_order_plan',
  simulateChanges: 'simulate_changes',
  presentOptions: 'present_options',
} as const

const changeSchema = {
  type: 'object',
  description: [
    '計画に当てる変更。kind ごとに使う項目が違う。',
    'materialDelay: orderId, days（未投入分の材料の入荷が何日遅れるか。早まるならマイナス）',
    'quantity: orderId, quantity（新しい総数量。投入済みの数より少なくはできない）',
    'equipmentDown: equipmentId, from, to（その期間、設備を使わない）',
    'overtime: equipmentId, from, to, minutesPerDay（その期間の稼働日に、終業を何分延ばすか）',
    'holidayWork: equipmentId, date（休日に通常の時間で動かす）',
    'expedite: orderId（その注番を最優先で流す）',
    'hold: orderId, until（その日まで着手しない。余力の注番を来月に回すときなど）',
    'addOrder: partNumber, quantity, due（製造注残を追加する。在庫切れを防ぐ補充など）',
    'headcount: crew, from, to, people（その期間の稼働日に、班に出ている人数。応援なら増やし、休みなら減らす）',
    '日付は YYYY-MM-DD。設備は equipmentId（例: MC-1）で指定する。',
  ].join('\n'),
  properties: {
    kind: {
      type: 'string',
      enum: [
        'materialDelay',
        'quantity',
        'equipmentDown',
        'overtime',
        'holidayWork',
        'expedite',
        'hold',
        'addOrder',
        'headcount',
      ],
    },
    orderId: { type: 'string' },
    partNumber: { type: 'string' },
    equipmentId: { type: 'string' },
    crew: { type: 'string' },
    people: { type: 'integer' },
    days: { type: 'integer' },
    quantity: { type: 'integer' },
    minutesPerDay: { type: 'integer' },
    from: { type: 'string' },
    to: { type: 'string' },
    date: { type: 'string' },
    until: { type: 'string' },
    due: { type: 'string' },
  },
  required: ['kind'],
} as const

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: TOOL_NAMES.getSituation,
    description:
      '今の計画の状態を返す。今月の見通し（売上・材料費・労務費・設備費・粗利・残業と休日出勤の時間・遅れる注番・来月末までの欠品）、品目（形状・売価・材料費・在庫・月間の出荷数）、段取り表、班（担当工程・設備・日ごとの人数と、同時に動いた設備の最大数）、設備と負荷、型番ごとの工程、注番ごとの区分（A 今月必要／B 来月必要／C それ以降）・必要日・進み具合・完成見込み。担当者が採用済みの変更も含む。',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: TOOL_NAMES.getOrderPlan,
    description:
      '1つの注番について、Lot ごと・工程ごとに、どの設備でいつからいつまで加工する計画かを返す。waitedForPeople は、設備は空いていたが班の人が空かずに待ったこと。どこで時間がかかっているかを調べるときに使う。',
    input_schema: {
      type: 'object',
      properties: { orderId: { type: 'string' } },
      required: ['orderId'],
    },
  },
  {
    name: TOOL_NAMES.simulateChanges,
    description:
      '変更を今の計画に当てて全注番を組み直し、完成見込みの変化と、今月の粗利・残業・休日出勤の増減、変更後の今月の見通しを返す。計画そのものは変えない。何度でも試せる。',
    input_schema: {
      type: 'object',
      properties: { changes: { type: 'array', items: changeSchema } },
      required: ['changes'],
    },
  },
  {
    name: TOOL_NAMES.presentOptions,
    description:
      '担当者に選んでもらう対策の案を画面にカードで出す。担当者から聞いた出来事（材料の遅れ、設備の故障など）は event に、対策は案ごとの changes に分けて書く。案ごとに、その手が効く理由と、その代わりに起きること（残業時間や後ろにずれる注番など）を書く。各案の効果は画面側で、出来事も当てたうえで計算し直して表示し、その結果を返す。',
    input_schema: {
      type: 'object',
      properties: {
        event: {
          type: 'array',
          description: '担当者から聞いた出来事。対策ではなく事実だけ。出来事がなければ空の配列',
          items: changeSchema,
        },
        options: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '案の短い名前' },
              changes: { type: 'array', items: changeSchema, description: '対策だけ。出来事は event に書く' },
              reason: { type: 'string', description: 'この手が効く理由' },
              tradeoff: { type: 'string', description: 'その代わりに起きること' },
            },
            required: ['title', 'changes', 'reason', 'tradeoff'],
          },
        },
      },
      required: ['event', 'options'],
    },
  },
]
