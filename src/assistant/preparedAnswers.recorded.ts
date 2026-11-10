// Written by `node scripts/record-answers.mjs`. Do not edit by hand.
import type { RecordedAnswers } from './preparedAnswers'

export const RECORDED: RecordedAnswers = {
  "recordedOn": "2026-11-10",
  "conversations": [
    {
      "prompt": "注番1045の材料が2日遅れると連絡がありました",
      "rounds": [
        {
          "content": [
            {
              "type": "tool_use",
              "id": "toolu_01CTh5vhQ3VGVo5Q6wHWSymg",
              "name": "get_situation",
              "input": {}
            },
            {
              "type": "tool_use",
              "id": "toolu_01MBw8ZBnRMW95YCNSuzgtkY",
              "name": "simulate_changes",
              "input": {
                "changes": [
                  {
                    "kind": "materialDelay",
                    "orderId": "1045",
                    "days": 2
                  }
                ]
              }
            }
          ],
          "stopReason": "tool_use",
          "resultHashes": [
            "wdq5pofwgv",
            "1cqmzz2k1lp"
          ]
        },
        {
          "content": [
            {
              "type": "tool_use",
              "id": "toolu_013beeYY9diY3z9pTeNz43db",
              "name": "get_order_plan",
              "input": {
                "orderId": "1045",
                "changes": [
                  {
                    "kind": "materialDelay",
                    "orderId": "1045",
                    "days": 2
                  }
                ]
              }
            }
          ],
          "stopReason": "tool_use",
          "resultHashes": [
            "13p845f17gt"
          ]
        },
        {
          "content": [
            {
              "type": "tool_use",
              "id": "toolu_01JbkpLJQwUcySDVzLPDnPx4",
              "name": "simulate_changes",
              "input": {
                "changes": [
                  {
                    "kind": "materialDelay",
                    "orderId": "1045",
                    "days": 2
                  },
                  {
                    "kind": "holidayWork",
                    "equipmentId": "MC-1",
                    "date": "2026-11-14"
                  },
                  {
                    "kind": "holidayWork",
                    "equipmentId": "MC-1",
                    "date": "2026-11-15"
                  }
                ]
              }
            },
            {
              "type": "tool_use",
              "id": "toolu_01R8r82aMNfUm8aRVXZLFoVE",
              "name": "simulate_changes",
              "input": {
                "changes": [
                  {
                    "kind": "materialDelay",
                    "orderId": "1045",
                    "days": 2
                  },
                  {
                    "kind": "holidayWork",
                    "equipmentId": "MC-1",
                    "date": "2026-11-14"
                  },
                  {
                    "kind": "holidayWork",
                    "equipmentId": "MC-1",
                    "date": "2026-11-15"
                  },
                  {
                    "kind": "holidayWork",
                    "equipmentId": "INS-1",
                    "date": "2026-11-21"
                  },
                  {
                    "kind": "holidayWork",
                    "equipmentId": "PCK-1",
                    "date": "2026-11-21"
                  }
                ]
              }
            }
          ],
          "stopReason": "tool_use",
          "resultHashes": [
            "1fll275umo1",
            "hiovnbiicy"
          ]
        },
        {
          "content": [
            {
              "type": "tool_use",
              "id": "toolu_017q639AdyYxfC7NedXeRF1x",
              "name": "get_order_plan",
              "input": {
                "orderId": "1045",
                "changes": [
                  {
                    "kind": "materialDelay",
                    "orderId": "1045",
                    "days": 2
                  },
                  {
                    "kind": "holidayWork",
                    "equipmentId": "MC-1",
                    "date": "2026-11-14"
                  },
                  {
                    "kind": "holidayWork",
                    "equipmentId": "MC-1",
                    "date": "2026-11-15"
                  }
                ]
              }
            }
          ],
          "stopReason": "tool_use",
          "resultHashes": [
            "1b8dhka0s59"
          ]
        },
        {
          "content": [
            {
              "type": "tool_use",
              "id": "toolu_01BHSRdG8GBDyeoZd8CtStcu",
              "name": "simulate_changes",
              "input": {
                "changes": [
                  {
                    "kind": "materialDelay",
                    "orderId": "1045",
                    "days": 2
                  },
                  {
                    "kind": "holidayWork",
                    "equipmentId": "MC-1",
                    "date": "2026-11-14"
                  },
                  {
                    "kind": "holidayWork",
                    "equipmentId": "MC-1",
                    "date": "2026-11-15"
                  },
                  {
                    "kind": "holidayWork",
                    "equipmentId": "HT-1",
                    "date": "2026-11-15"
                  }
                ]
              }
            },
            {
              "type": "tool_use",
              "id": "toolu_01CbjBc7PLqoHAdicjdpuoVH",
              "name": "simulate_changes",
              "input": {
                "changes": [
                  {
                    "kind": "materialDelay",
                    "orderId": "1045",
                    "days": 2
                  },
                  {
                    "kind": "holidayWork",
                    "equipmentId": "MC-1",
                    "date": "2026-11-14"
                  }
                ]
              }
            }
          ],
          "stopReason": "tool_use",
          "resultHashes": [
            "ygux28lsca",
            "13zgc38adhv"
          ]
        },
        {
          "content": [
            {
              "type": "tool_use",
              "id": "toolu_01NjwLNee1J5DcWnRTpeee4d",
              "name": "simulate_changes",
              "input": {
                "changes": [
                  {
                    "kind": "materialDelay",
                    "orderId": "1045",
                    "days": 2
                  },
                  {
                    "kind": "quantity",
                    "orderId": "1045",
                    "quantity": 45
                  },
                  {
                    "kind": "addOrder",
                    "partNumber": "B-200",
                    "quantity": 45,
                    "due": "2026-11-17"
                  }
                ]
              }
            }
          ],
          "stopReason": "tool_use",
          "resultHashes": [
            "5hwhlwe1ak"
          ]
        },
        {
          "content": [
            {
              "type": "tool_use",
              "id": "toolu_01AFDeEiEMji9igVDQdtzoAR",
              "name": "present_options",
              "input": {
                "event": [
                  {
                    "kind": "materialDelay",
                    "orderId": "1045",
                    "days": 2
                  }
                ],
                "options": [
                  {
                    "title": "手持ち材料で45個を先行して分ける",
                    "changes": [
                      {
                        "kind": "quantity",
                        "orderId": "1045",
                        "quantity": 45
                      },
                      {
                        "kind": "addOrder",
                        "partNumber": "B-200",
                        "quantity": 45,
                        "due": "2026-11-17"
                      }
                    ],
                    "reason": "B-200の未引当の材料在庫（60個分）で、取引先B向け45個を別の注番にして今日から流す。遅れる材料を待つのは残りの45個（取引先C向け）だけになり、1ロットで直列に流れていた待ちが半分になる。",
                    "tradeoff": "未引当の材料を45個分使うので、残りは15個分になる（1045の材料が着けば、余る45個分が戻る）。B-200の補充（12/2までに132個）の材料は別に発注が要る。注番1040の完成が1日ずれるが、納期には余裕がある。"
                  },
                  {
                    "title": "マシニング1を11/14に休日出勤",
                    "changes": [
                      {
                        "kind": "holidayWork",
                        "equipmentId": "MC-1",
                        "date": "2026-11-14"
                      }
                    ],
                    "reason": "1045はマシニング1の切削から全工程が1ロットで直列に流れるので、土曜に切削を進めて後ろの工程を前倒しする。",
                    "tradeoff": "休日出勤の人件費が掛かり、それでも1045は1日遅れが残る（材料が11/13着だと、全工程を通すのに間に合わない）。"
                  }
                ]
              }
            }
          ],
          "stopReason": "tool_use",
          "resultHashes": [
            "hs3dfcu0ds"
          ]
        },
        {
          "content": [
            {
              "type": "text",
              "text": "何もしないと、注番1045の完成は11/19から11/22にずれ、納期に3日遅れます。B-200の欠品も11/22まで続きます。\n\n選ぶときは、手持ちの材料を先に使ってよいかどうかで決まります。1つ目の案は休日出勤なしで遅れがなくなりますが、まだ注番に割り当てていないB-200の材料（60個分）のうち45個分を使います。11/13着の1045の材料でその分は戻りますが、使ってよいか確かめてください。2つ目の休日出勤の案では、1日の遅れが残ります。\n\n試算は、材料の入荷が11/11から2日遅れて11/13になる前提です。\n\n材料の遅れとは別に、今の計画にもともと3つ問題があります。手を試すか教えてください。\n- **取引先B（1045の45個）**：今の完成見込み11/19では、約束した11/17に2日遅れています。1つ目の案なら11/13に完成するので、この遅れもなくなります。\n- **B-200の欠品**：11/12から最大29個足りなくなります。\n- **B-200の補充**：12/2から132個足りず、来月末までに解消しません。補充の材料は発注期限の11/9を過ぎているので、今日頼んでも着くのは11/17です。"
            }
          ],
          "stopReason": "end_turn",
          "resultHashes": []
        }
      ]
    },
    {
      "prompt": "旋回フレームの部品の商談が取れたら、納期に間に合いますか？",
      "rounds": [
        {
          "content": [
            {
              "type": "tool_use",
              "id": "toolu_01XBzrJEgDLUW236N1pPJMAg",
              "name": "get_situation",
              "input": {}
            }
          ],
          "stopReason": "tool_use",
          "resultHashes": [
            "wdq5pofwgv"
          ]
        },
        {
          "content": [
            {
              "type": "tool_use",
              "id": "toolu_012qg7h3JjtFp1FZx4ehbD12",
              "name": "simulate_changes",
              "input": {
                "changes": [
                  {
                    "kind": "addOrder",
                    "partNumber": "B-200",
                    "quantity": 180,
                    "due": "2027-01-29"
                  },
                  {
                    "kind": "hold",
                    "orderId": "追加1",
                    "until": "2026-12-15"
                  }
                ]
              }
            }
          ],
          "stopReason": "tool_use",
          "resultHashes": [
            "1azgcmijphi"
          ]
        },
        {
          "content": [
            {
              "type": "text",
              "text": "結論から言うと、**旋回フレームの部品（S-0302、取引先F、B-200）は、取れれば納期に間に合います。**\n\n試算は、初回分として量産数量60個の3か月分の180個を、1月末の稼働日1/29納期で注残に足し、受注予定日の12/15まで着手しない前提で組みました。\n\n- **完成見込み:** 12/31 14:45で、納期まで約1か月の余裕があります。\n- **ほかの注番への影響:** 完成日が動く注番はなく、遅れも出ません。\n- **今月の粗利:** 2,940,925円のままです。残業と休日出勤の時間も増えません。\n- **材料:** B-200の手元の材料（どの注残にも引き当てていない分）は60個分しかありません。180個作るには発注が要り、調達に7日かかるので、着手の12/15に間に合うよう手配してください。\n- **欠品の見え方:** 試算では12月の欠品が減って見えます。ただ、この180個は取引先Fに出す分なので、欠品の手当てにはなりません。\n\nこの商談とは別に、今の計画にはもともとB-200の欠品が2つあります。\n\n- **11/12〜11/19:** いちばん多いときで29個足りません。\n- **12/2から:** いちばん多いときで132個足りず、来月末までに解消しません。補充は12/2までに132個必要です。材料の発注期限（11/9）はもう過ぎていて、今日頼んでも材料が着くのは11/17です。\n\nこちらの対策（補充の注残の追加など）を試算しますか？"
            }
          ],
          "stopReason": "end_turn",
          "resultHashes": []
        }
      ]
    },
    {
      "prompt": "マシニング1が明日1日止まります",
      "rounds": [
        {
          "content": [
            {
              "type": "tool_use",
              "id": "toolu_017wUHHcrDPb5wj283sPE4Zo",
              "name": "get_situation",
              "input": {}
            }
          ],
          "stopReason": "tool_use",
          "resultHashes": [
            "wdq5pofwgv"
          ]
        },
        {
          "content": [
            {
              "type": "tool_use",
              "id": "toolu_01XmfrN5Wk4FNrz7MHsYsNHX",
              "name": "simulate_changes",
              "input": {
                "changes": [
                  {
                    "kind": "equipmentDown",
                    "equipmentId": "MC-1",
                    "from": "2026-11-11",
                    "to": "2026-11-11"
                  }
                ]
              }
            }
          ],
          "stopReason": "tool_use",
          "resultHashes": [
            "1b4xwc3trk2"
          ]
        },
        {
          "content": [
            {
              "type": "tool_use",
              "id": "toolu_015Dbnma8jZk6QA4Qzs17cVv",
              "name": "get_order_plan",
              "input": {
                "orderId": "1045",
                "changes": [
                  {
                    "kind": "equipmentDown",
                    "equipmentId": "MC-1",
                    "from": "2026-11-11",
                    "to": "2026-11-11"
                  }
                ]
              }
            }
          ],
          "stopReason": "tool_use",
          "resultHashes": [
            "2bjhdfh52i9"
          ]
        },
        {
          "content": [
            {
              "type": "tool_use",
              "id": "toolu_016spFwCDe3h1q4XA5vv7akY",
              "name": "simulate_changes",
              "input": {
                "changes": [
                  {
                    "kind": "equipmentDown",
                    "equipmentId": "MC-1",
                    "from": "2026-11-11",
                    "to": "2026-11-11"
                  },
                  {
                    "kind": "holidayWork",
                    "equipmentId": "MC-1",
                    "date": "2026-11-14"
                  }
                ]
              }
            },
            {
              "type": "tool_use",
              "id": "toolu_01VN8a3JhRgaWAUW97ZDLURp",
              "name": "simulate_changes",
              "input": {
                "changes": [
                  {
                    "kind": "equipmentDown",
                    "equipmentId": "MC-1",
                    "from": "2026-11-11",
                    "to": "2026-11-11"
                  },
                  {
                    "kind": "holidayWork",
                    "equipmentId": "MC-1",
                    "date": "2026-11-14"
                  },
                  {
                    "kind": "holidayWork",
                    "equipmentId": "HT-1",
                    "date": "2026-11-15"
                  }
                ]
              }
            },
            {
              "type": "tool_use",
              "id": "toolu_01Mx1LYrRSGWDevW8VCY6sC7",
              "name": "simulate_changes",
              "input": {
                "changes": [
                  {
                    "kind": "equipmentDown",
                    "equipmentId": "MC-1",
                    "from": "2026-11-11",
                    "to": "2026-11-11"
                  },
                  {
                    "kind": "expedite",
                    "orderId": "1045"
                  }
                ]
              }
            }
          ],
          "stopReason": "tool_use",
          "resultHashes": [
            "6ik4r5dzi8",
            "gr27z35iqz",
            "1wk5s7yfz8r"
          ]
        },
        {
          "content": [
            {
              "type": "tool_use",
              "id": "toolu_014FoufYGeVkafsrwXnweeug",
              "name": "simulate_changes",
              "input": {
                "changes": [
                  {
                    "kind": "equipmentDown",
                    "equipmentId": "MC-1",
                    "from": "2026-11-11",
                    "to": "2026-11-11"
                  },
                  {
                    "kind": "holidayWork",
                    "equipmentId": "HT-1",
                    "date": "2026-11-15"
                  }
                ]
              }
            },
            {
              "type": "tool_use",
              "id": "toolu_01PRuL6PPVyeFFmgDkpFm231",
              "name": "simulate_changes",
              "input": {
                "changes": [
                  {
                    "kind": "equipmentDown",
                    "equipmentId": "MC-1",
                    "from": "2026-11-11",
                    "to": "2026-11-11"
                  },
                  {
                    "kind": "holidayWork",
                    "equipmentId": "MC-1",
                    "date": "2026-11-15"
                  }
                ]
              }
            },
            {
              "type": "tool_use",
              "id": "toolu_01Hgha9uYr1SjWAYjr9Kcmi4",
              "name": "simulate_changes",
              "input": {
                "changes": [
                  {
                    "kind": "equipmentDown",
                    "equipmentId": "MC-1",
                    "from": "2026-11-11",
                    "to": "2026-11-11"
                  },
                  {
                    "kind": "holidayWork",
                    "equipmentId": "MC-1",
                    "date": "2026-11-14"
                  },
                  {
                    "kind": "holidayWork",
                    "equipmentId": "HT-1",
                    "date": "2026-11-14"
                  }
                ]
              }
            }
          ],
          "stopReason": "tool_use",
          "resultHashes": [
            "1wv1kqttxrj",
            "2fn7lbqacig",
            "moidvxp0a7"
          ]
        },
        {
          "content": [
            {
              "type": "tool_use",
              "id": "toolu_01VdE8WQEnn6V9FZ82vmRhoH",
              "name": "simulate_changes",
              "input": {
                "changes": [
                  {
                    "kind": "equipmentDown",
                    "equipmentId": "MC-1",
                    "from": "2026-11-11",
                    "to": "2026-11-11"
                  },
                  {
                    "kind": "holidayWork",
                    "equipmentId": "HT-1",
                    "date": "2026-11-14"
                  }
                ]
              }
            },
            {
              "type": "tool_use",
              "id": "toolu_01LyCg443HiQkJGThh25HVtR",
              "name": "simulate_changes",
              "input": {
                "changes": [
                  {
                    "kind": "equipmentDown",
                    "equipmentId": "MC-1",
                    "from": "2026-11-11",
                    "to": "2026-11-11"
                  },
                  {
                    "kind": "holidayWork",
                    "equipmentId": "MC-1",
                    "date": "2026-11-14"
                  },
                  {
                    "kind": "holidayWork",
                    "equipmentId": "GRD-1",
                    "date": "2026-11-15"
                  }
                ]
              }
            }
          ],
          "stopReason": "tool_use",
          "resultHashes": [
            "1kavn2lp7cx",
            "1w33w0u08b"
          ]
        },
        {
          "content": [
            {
              "type": "tool_use",
              "id": "toolu_01UAT4sJDCHqc7N3sasPBwHq",
              "name": "present_options",
              "input": {
                "event": [
                  {
                    "kind": "equipmentDown",
                    "equipmentId": "MC-1",
                    "from": "2026-11-11",
                    "to": "2026-11-11"
                  }
                ],
                "options": [
                  {
                    "title": "11/14(土) マシニング1と熱処理炉1を休日出勤",
                    "changes": [
                      {
                        "kind": "holidayWork",
                        "equipmentId": "MC-1",
                        "date": "2026-11-14"
                      },
                      {
                        "kind": "holidayWork",
                        "equipmentId": "HT-1",
                        "date": "2026-11-14"
                      }
                    ],
                    "reason": "1045の切削を土曜に一日中進めて止まった1日分を取り戻し、同じ日に熱処理も続けて回すので、研削・検査が前に寄って11/19に間に合う。",
                    "tradeoff": "土曜に2台分の人を呼ぶ休日出勤（夜の分は深夜割増つき）で、今月の粗利が減る。"
                  },
                  {
                    "title": "11/14 マシニング1、11/15 熱処理炉1を休日出勤",
                    "changes": [
                      {
                        "kind": "holidayWork",
                        "equipmentId": "MC-1",
                        "date": "2026-11-14"
                      },
                      {
                        "kind": "holidayWork",
                        "equipmentId": "HT-1",
                        "date": "2026-11-15"
                      }
                    ],
                    "reason": "土曜に切削、日曜に熱処理を一日中回して1045を11/19に間に合わせる。熱処理炉の休日出勤を日曜に置くので、土曜の段取りや人の都合で炉を回せないときの代わりになる。",
                    "tradeoff": "休日出勤の時間が案1より多く、粗利の減りも大きい。C区分の1050が前倒しになるが、今月の売上は変わらない。"
                  }
                ]
              }
            }
          ],
          "stopReason": "tool_use",
          "resultHashes": [
            "dw334to17f"
          ]
        },
        {
          "content": [
            {
              "type": "text",
              "text": "何もしないと、注番1045（B-200・90個）の完成が11/19から11/20 09:10にずれて、納期に1日遅れます。B-200の欠品も11/20まで続きます（いちばん多いときで33個）。対策の案を2つ画面に出しました。どちらも1045は納期に間に合います。\n\nマシニング1の休日出勤だけ、熱処理炉1の休日出勤だけでは、どちらも1日遅れが残りました。両方を合わせて動かす必要があります。\n\n- **案1（土曜に2台）：** 粗利の減りは112,375円で、安く済みます。\n- **案2（土曜にマシニング1、日曜に熱処理炉1）：** 粗利は170,750円減ります。土曜に2人呼べないときの代わりです。\n\nどちらを選ぶかは、11/14の土曜に機械班へ2人を呼べるかで決まります。\n\n試算では「明日1日」を11/11の0時〜24時（3直すべて）として置きました。止まるのが一部の直だけなら、試算し直します。\n\n止まる件とは別に、今の計画にもともとある問題が2つあります。手を試しますか？\n- 1045のうち取引先B向けの45個は、回答納期が11/17です。今の計画のままでも2日遅れます。\n- B-200は、在庫と注残を全部足しても12/2から132個足りず、来月末までに解消しません。材料の発注期限（11/9）も過ぎています。"
            }
          ],
          "stopReason": "end_turn",
          "resultHashes": []
        }
      ]
    },
    {
      "prompt": "今いちばん危ない注番はどれ？",
      "rounds": [
        {
          "content": [
            {
              "type": "tool_use",
              "id": "toolu_013jb5DAkRUCCJ3KK1E4QTg1",
              "name": "get_situation",
              "input": {}
            }
          ],
          "stopReason": "tool_use",
          "resultHashes": [
            "wdq5pofwgv"
          ]
        },
        {
          "content": [
            {
              "type": "tool_use",
              "id": "toolu_01FyuPSAHJTRrZoSTHwt6wNj",
              "name": "get_order_plan",
              "input": {
                "orderId": "1045"
              }
            }
          ],
          "stopReason": "tool_use",
          "resultHashes": [
            "f76ibawr8a"
          ]
        },
        {
          "content": [
            {
              "type": "text",
              "text": "いちばん危ないのは**注番1045（B-200・90個、納期11/19）**です。\n\n- **取引先Bとの約束に間に合いません。** 完成見込みは11/19 9:10で、注番の納期には当日でぎりぎり間に合います。ただ、取引先Bの45個は回答納期が11/17なので、2日遅れます。\n- **B-200は11/12から欠品します。** 在庫が0で、1045の完成を待つため11/12〜11/19に最大29個足りなくなります。\n- **工程の流れ方:** 材料は11/11に入ります。90個を1つのLotのまま「切削（〜11/13）→熱処理（〜11/16）→研削（〜11/18）→検査→梱包」と順に流すので、後ろの工程ほど待ちが長くなります。土日の熱処理は、休日に出る1人の勤務時間（8〜16時）だけで動きます。\n\nB-200は、この先も心配があります。\n- **12/2から欠品します。** 来月末まで132個足りないままです。補充に使う材料の発注期限は11/9で、もう過ぎています。今日頼んでも、材料が入るのは11/17です。\n- **代理店の取引先Eも在庫切れの見込みです。** B-200の在庫は0の見込みで、60個の注文が今日来てもおかしくありません。この分は上の132個とは別に数えます。\n\nほかの注番（1030・1021・1022・1040・1034・1050）は、どれも納期まで余裕があります。\n\n1045の対策（優先、休日出勤など）と、B-200の補充（132個・12/2まで）を試算しますか？"
            }
          ],
          "stopReason": "end_turn",
          "resultHashes": []
        }
      ]
    }
  ]
}
