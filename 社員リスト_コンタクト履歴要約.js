(function () {
  'use strict';

  // APIキーは直書き非推奨
  const OPENAI_API_KEY = '';
  const ACTIVITY_APP_ID = 17;   // 技術者コンタクト活動履歴のアプリID
  const LINK_FIELD = '社員レコード番号';        // 「技術者」ルックアップにてコピーされた社員リストのレコード番号（$id）
  const SUMMARY_FIELD = 'コンタクト履歴要約';   // 社員リストのコンタクト履歴要約のフィールドコード

  // ローディング用スタイル追加
  (function addLoadingStyle() {
    if (document.getElementById('gptLoadingStyle')) return;
    const style = document.createElement('style');
    style.id = 'gptLoadingStyle';
    style.innerHTML = `
    #gptLoadingOverlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.35);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .gpt-loading-box {
      background: #fff;
      padding: 24px 32px;
      border-radius: 10px;
      text-align: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      min-width: 260px;
    }

    .gpt-loading-text {
      font-size: 14px;
      margin-bottom: 12px;
      color: #333;
    }

    .gpt-spinner {
      width: 32px;
      height: 32px;
      border: 4px solid #ddd;
      border-top-color: #3498db;
      border-radius: 50%;
      animation: gpt-spin 1s linear infinite;
      margin: 0 auto;
    }

    @keyframes gpt-spin {
      to { transform: rotate(360deg); }
    }

    /* ボタン下の注記スタイル */
    .gpt-note {
      margin-top: 6px;
      font-size: 12px;
      color: #666;
      line-height: 1.4;
      white-space: normal;
    }
  `;
    document.head.appendChild(style);
  })();

  // 処理中オーバーレイ表示
  function showLoadingOverlay() {
    if (document.getElementById('gptLoadingOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'gptLoadingOverlay';
    overlay.innerHTML = `
    <div class="gpt-loading-box">
      <div class="gpt-loading-text">要約処理中です…</div>
      <div class="gpt-spinner"></div>
    </div>
  `;
    document.body.appendChild(overlay);
  }

  // 処理中オーバーレイ非表示
  function hideLoadingOverlay() {
    const overlay = document.getElementById('gptLoadingOverlay');
    if (overlay) overlay.remove();
  }

  kintone.events.on('app.record.detail.show', function (event) {
    if (document.getElementById('askGptBtn')) return;

    // ボタンと注記をまとめるコンテナ
    const container = document.createElement('div');
    container.id = 'askGptContainer';

    const button = document.createElement('button');
    button.id = 'askGptBtn';

    // ボタン文言
    button.innerText = 'コンタクト履歴のAI要約';

    // ボタン下の注記
    const note = document.createElement('div');
    note.className = 'gpt-note';
    note.innerText = '※OpenAI APIを利用して要約を生成します。利用量に応じて料金が発生します。';

    button.onclick = async () => {
      if (button.disabled) return;  // 二重実行防止
      try {
        button.disabled = true;     // 処理中表示
        showLoadingOverlay();       // オーバーレイ表示
        const employeeRecordId = event.record.$id.value;
        // 活動履歴取得
        const query = `${LINK_FIELD} = ${employeeRecordId} order by 対応日時 desc`;
        const resp = await kintone.api(
          kintone.api.url('/k/v1/records', true),
          'GET',
          {
            app: ACTIVITY_APP_ID,
            query: query,
            fields: ['対応日時', 'ヒアリング_現場関連', 'ヒアリング_本人関連', 'ヒアリング_会社関連', '所感']
          }
        );
        if (!resp.records.length) {
          alert('対象社員の活動履歴がありません');
          return;
        }
        // 活動履歴をまとめる
        const text = resp.records.map(r => {
          return `
【対応日時】${r.対応日時.value}
【ヒアリング（現場）】${r.ヒアリング_現場関連.value || ''}
【ヒアリング（本人）】${r.ヒアリング_本人関連.value || ''}
【ヒアリング（会社）】${r.ヒアリング_会社関連.value || ''}
【所感】${r.所感.value || ''}
`;
        }).join('\n');
        //console.log(text); // 検証用
        // GPT 呼び出し
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: `あなたはSES企業の技術者フォロー担当です。
人材マネジメントの観点で、活動履歴の内容をもとに、技術者の状況を客観的かつ簡潔に整理・要約してください。

【活動履歴の構成】
以下の項目は、活動履歴を読み取るための共通構成です。
・対応日時：コンタクトを行った日時 
・ヒアリング①（現場関連）：現場での業務内容・課題・状況 
・ヒアリング②（本人関連）：本人の悩み・不安・意向 
・ヒアリング③（会社からの確認）：会社側からの確認事項やコメント 
・所感：フォロー担当者の主観的な所感

【出力項目】
・業務・スキル・職場環境の状況
・指摘事項・課題（顧客／現場からの指摘・未解消課題）
・変化・成長・安定している点
・本人の悩み・不安・意向
・今後のフォローポイント

【制約】
・出力項目名は「【項目名】」の形式で記載し、 内容は全て「・」による箇条書きで統一する
・「今後のフォローポイント」以外の各項目の先頭に可能な範囲で対象年月などを括弧書きで記載する
  例：（2025年10月）、（2025年7月以降）、（2024年3月頃～2025年8月）
・冗長にならない範囲で簡潔に記載する
・該当する内容がない場合は、無理に記載せず、未該当であることが分かる形で示す
・客観的で人事向けの文体を用いる
・活動履歴に記載されていない内容については推測や新たな評価・判断を行わない
・活動履歴は時系列情報として扱い、記載内容の前後関係を考慮する
・各項目内の対象年月が記載された箇条書きは、必ず新しい情報から古い情報の順（降順）で記載する
・トラブルやリスク、ネガティブな内容については重要情報として扱う。
・顧客や現場からの評価については重要情報として、表現をそのまま保持する
`
              },
              {
                role: 'user',
                content: text
              }
            ],
            temperature: 0.2
          })
        });

        const data = await response.json();
        const summaryText = data.choices[0].message.content;
        // 社員リストに上書き保存
        await kintone.api(
          kintone.api.url('/k/v1/record', true),
          'PUT',
          {
            app: kintone.app.getId(),
            id: employeeRecordId,
            record: {
              [SUMMARY_FIELD]: {
                value: summaryText
              }
            }
          }
        );
        location.reload();
      } catch (e) {
        console.error(e);
        alert('要約処理中にエラーが発生しました');

      } finally {
        // オーバーレイ解除
        hideLoadingOverlay();
        button.disabled = false;
      }
    };

    // コンテナに追加して配置
    container.appendChild(button);
    container.appendChild(note);
    kintone.app.record.getHeaderMenuSpaceElement().appendChild(container);
  });
})();
