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
    'materialDelay: orderId, days（未投入分の材料の入荷が、暦の日数で何日遅れるか。早まるならマイナス。材料は入荷日の0時から使える扱いで、休日に当たっても同じ）',
    'quantity: orderId, quantity（新しい総数量。投入済みの数より少なくはできない）',
    'equipmentDown: equipmentId, from, to（その期間、設備を使わない）',
    'overtime: equipmentId, from, to, minutesPerDay（その期間の稼働日に、終業を何分延ばすか。残業の時間は、延ばした枠のうち実際に動いた分だけ数える。延ばした時間も、その日に班に出ている人数の中で動く）',
    'holidayWork: equipmentId, date（休日に通常の時間で動かす。班の人数とは別に、その設備に1人が出る。休日出勤の時間は、実際に動いた分だけ数える）',
    'expedite: orderId（その注番を最優先で流す）',
    'hold: orderId, until（その日まで着手しない。余力の注番を来月に回すときなど）',
    'addOrder: partNumber, quantity, due（製造注残を追加する。在庫切れを防ぐ補充など。材料は手元にある扱いで組むので、材料在庫が足りないときは手配が要ることを伝える）',
    'headcount: crew, from, to, people（その期間の稼働日に、班に出る人数そのもの。休む人数や増減ではない。日ごとの予定の人数は get_situation の班の days にある。予定が日によって違うときは、期間を分けて日ごとの人数を書く。同じ日に重なる headcount は、後に当てたものが使われる）',
    '日付は YYYY-MM-DD。期間の from と to は、どちらもその日を含む。設備は equipmentId（例: MC-1）で指定する。',
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
      '今の計画の状態を返す。今月の見通し（売上・材料費・労務費・設備の運転費・粗利・残業と休日出勤の時間・遅れる注番・来月末までの欠品）、品目（形状・売価・材料費・在庫・月間の出荷数）、段取り表、班（担当工程・設備・日ごとの人数と、同時に動いた設備の最大数）、設備（1時間の運転費・直前の型番）と負荷、型番ごとの工程、注番ごとの区分（A 今月必要／B 来月必要／C それ以降）・必要日・進み具合・完成見込み。担当者が採用済みの変更も含む。注番ごとの deliveries は、その注番が満たす取引先の受注（数量・希望納期・回答納期。未回答は answered が null）で、daysLate は完成見込みが回答納期より何日遅いか（正なら約束に間に合わない）で、注番が計画に入らないときは unplanned が true。品目の materialStock は、どの注残にも引き当てていない材料在庫で、作れる個数。注番の materialOn が null なら、その注番の材料は手元にある。欠品の maxShortage はその期間でいちばん多く足りない個数で、until が null なのは、来月末までに解消しないこと。replenishments は、来月末までの出荷に、在庫と全部の注残を足しても足りない数（quantity）と、いつまでに要るか（needBy）。addOrder の数量と納期にそのまま使える。',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: TOOL_NAMES.getOrderPlan,
    description:
      '1つの注番について、Lot ごと・工程ごとに、どの設備でいつからいつまで加工する計画かを返す。waitedForPeople は、設備は空いていたが班の人が空かずに待ったこと（作業は途中で止めないので、人のいない日をまたぐ作業も、その日が過ぎるまで待つ）。planned は、まだ投入していない分で、Lot番号は投入の予定の番号。どこで時間がかかっているかを調べるときに使う。changes を渡すと、その変更を当てて組み直した計画で返す（計画そのものは変えない）。',
    input_schema: {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        changes: { type: 'array', items: changeSchema, description: '当てて見たい変更。今の計画を見るなら省く' },
      },
      required: ['orderId'],
    },
  },
  {
    name: TOOL_NAMES.simulateChanges,
    description:
      '変更を今の計画に当てて全注番を組み直し、完成見込みの変化と、今月の粗利・残業・休日出勤の増減、変更後の今月の見通しを返す。shifted には、完成日か遅れが変わった注番が入り、before と after は変更前と変更後の完成見込みの日時。shifted にない注番は完成日が変わらない（その日の中の時刻は get_order_plan で確かめる）。遅れは日付で決まり、納期の日のうちに完成すれば遅れではない。unusedChanges は、残業や休日出勤のうち、その時間に加工する作業がなく使われなかった変更（期間の中で1分でも加工があれば、使われたとみなす）。計画そのものは変えない。何度でも試せる。',
    input_schema: {
      type: 'object',
      properties: { changes: { type: 'array', items: changeSchema } },
      required: ['changes'],
    },
  },
  {
    name: TOOL_NAMES.presentOptions,
    description:
      '担当者に選んでもらう対策の案を画面にカードで出す。担当者から聞いた出来事（材料の遅れ、設備の故障など）と、担当者がやろうとしていること（応援に人を出すなど）は event に、あなたの対策は案ごとの changes に分けて書く。案ごとに、その手が効く理由と、その代わりに起きること（残業時間や後ろにずれる注番など）を書く。各案の効果は画面側で、event のあとに案の changes を当てて計算し直して表示し、その結果を返す。ifNothingIsDone は event だけを当てた結果。案の changes に、使われない残業や休日出勤があると、エラーで返す。',
    input_schema: {
      type: 'object',
      properties: {
        event: {
          type: 'array',
          description: '担当者から聞いた出来事と、担当者がやろうとしていること。あなたの対策は入れない。なければ空の配列',
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
              changes: { type: 'array', items: changeSchema, description: '対策だけ。event に書いたものは繰り返さない。event の一部を変える案（応援の日をずらすなど）は、変える日の変更だけをここに書く' },
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
