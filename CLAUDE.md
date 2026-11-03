# サキヨミ

ハッカソン「Built with Claude: Japan 2026」の提出物を作るリポジトリです。作業の前に [docs/hackathon.md](docs/hackathon.md) の「守ること」を読んでください。

- コードと文書は、すべてハッカソンの期間中（2026-11-02 12:00 以降）に、このリポジトリで新しく書く
- 公開されるので、鍵や個人情報を書いたファイルを作らない
- 提出フォームで「一番詰まった場面」を、①何を作ろうとしたか ②Claude にどう指示したか ③何が起きたか ④期待とどう違ったか ⑤どう対処したか、の順で聞かれる。詰まったら、その場で [docs/開発メモ.md](docs/開発メモ.md) に書いておく
- README（英語）と README.ja.md（日本語）には、審査員がアプリを試せる手順を書く。片方を変えたら、もう片方も合わせる
- 構成は [docs/構成.md](docs/構成.md) に従う。`src/engine/` は React を使わない純粋な TypeScript にして、変えたら `npm test` を通す。画面や Worker を変えたら `npm run build` と `npm run lint` も通す
- Claude に渡すツールの定義（`src/assistant/toolSchemas.ts`）と指示文（`worker/systemPrompt.ts`）を変えたら、ツールの実行（`src/assistant/tools.ts`）とテストも合わせる
- アプリの Claude の動きは、まず [.claude/agents/sakiyomi-assistant.md](.claude/agents/sakiyomi-assistant.md) の役で確かめる。この役は、`scripts/assistant-tool.mjs` を通して、アプリと同じ指示文・ツールの定義・ツールの結果だけを見る。prompt には担当者のメッセージだけを渡し、機能の説明や期待する答えは書かない。この役が Agent の種類に出ないときは、定義ファイルの本文を prompt の先頭に置き（フォルダは絶対パスで書く）、`general-purpose` で呼ぶ。区切りごとと提出前には、ブラウザの相談欄から API でも確かめる
- デモ動画に映すのは、このリポジトリで作った画面と、自分が権利を持つ素材だけ
