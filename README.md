# FF_manage

## 画面の自動テスト

`index.html` を変更すると、GitHub Actionsが自動で画面の動作を確認します(`.github/workflows/ui-tests.yml`)。実際の運用端末である12.3インチタブレット相当の画面サイズで、ホーム画面のタイル表示・タブ切り替え・スケジュール目標・店舗マスタを検証しています。

手元で実行する場合:

```
npm install
npx playwright install chromium   # 初回のみ
npm test
```

テストが失敗すると、Actionsの実行結果に失敗時のスクリーンショットが残るので、どこが崩れたかを画面で確認できます。

## データ管理 (Firebase)

このアプリはFirebase Authentication(店舗番号PINコード方式)とCloud Firestoreでデータを管理しています。

- `index.html` 内の `firebaseConfig`(空欄)に、Firebaseコンソール「プロジェクトの設定」→「マイアプリ」で取得できる値を貼り付けてください。
- Firestore Security Rules(`firestore.rules`)・Storage Security Rules(`storage.rules`)・Cloud Functions(`functions/`)は `main` ブランチへのpush時にGitHub Actionsで自動デプロイされます。デプロイには、リポジトリシークレット `FIREBASE_SERVICE_ACCOUNT`(サービスアカウントJSON)の登録、サービスアカウントへの `Service Usage Consumer` / `Firebase Rules Admin` / `Firebase Storage Admin`(または `Storage Object Admin`) / `Cloud Functions Developer` / `Service Account User` / `Cloud Build Editor` / `Artifact Registry Writer` ロールの付与、`.firebaserc` の `default` プロジェクトIDの設定が必要です(Cloud Functionsの利用にはプロジェクトの課金プラン(Blaze)への切り替えが必要です)。

### 商品画像のアップロード (Firebase Storage)

商品マスタの「📷」ボタンから、スマートフォンのカメラロール等の画像をFirebase Storageへ直接アップロードできます。Firebase Storageの利用にはプロジェクトによって課金プラン(Blaze)への切り替えが必要になる場合があります。アップロードが失敗する場合は、「🔗」ボタンからGyazo等の外部画像アップロードサービスのURLを直接入力してください(この場合Firebase Storageは使用しません)。

### 新商品のAI自動登録 (Cloud Functions + Claude API)

商品マスタの「📸 AIで撮って登録」ボタンから、商品パッケージ・ラベルの写真を1枚選ぶと、AI(Claude API)が商品名・分類・価格・販売期限を読み取り、内容確認のダイアログを表示します。そこで「OK」を押すだけで、写真のアップロードと商品マスタへの登録(クラウド保存)まで完了します(手動での保存操作は不要です)。内容が誤っている場合は「キャンセル」すれば何も登録されません。登録後に価格や分類を直したい場合は、商品マスタ画面で通常の商品と同様に編集・保存してください。

セットアップ(初回のみ、リポジトリの管理者がFirebase CLIで実行):
1. [Anthropic Console](https://console.anthropic.com/) でAPIキーを取得する
2. プロジェクトルートで以下を実行し、APIキーをCloud Functionsのシークレットとして登録する
   ```
   cd functions && npm install
   firebase functions:secrets:set ANTHROPIC_API_KEY
   ```
3. 上記コマンドを実行すると、Cloud Functionsの実行サービスアカウントに対してシークレットへのアクセス権が自動付与されます
4. 以降は `functions/` 配下を変更してpushすれば、GitHub Actionsで自動的に再デプロイされます

**注意**: この機能はAnthropicのAPIを呼び出すたびに少額の利用料が発生します。またCloud Functionsの実行にはFirebaseプロジェクトの課金プラン(Blaze)が必要です。AIが読み取った内容は必ず保存前に確認してください(価格や分類を誤認識する場合があります)。

### ログイン(店舗番号PINコード)

スタッフは各店舗の店舗番号(例: `fm71661`)をPINとして入力するだけでログインでき、ログインと同時にその店舗のデータが自動的に開きます。裏側では、店舗番号ごとに `store-{番号}@ff-manage.local` という固定形式のダミーメールアドレスでFirebase Authenticationの共有アカウントを1つ登録し、その番号自体をパスワード(PIN)として扱っています。

新しい店舗を追加する手順:
1. Firebase Console → Authentication → Sign-in method で「メール/パスワード」を有効化(初回のみ)
2. Authentication → Users → 「ユーザーを追加」で、以下の内容を登録する
   - メールアドレス: `store-{店舗番号}@ff-manage.local`(例: `store-fm71661@ff-manage.local`)
   - パスワード: その店舗番号自体(Firebaseの制約で **6文字以上** が必要)
3. そのPINで初めてログインすると、店舗マスタにその店舗が自動的に追加されます(店舗名は後から「店舗マスタ」画面で編集してください)

「現在の店舗」の選択は端末ごとにブラウザへ保存され、他店舗の端末の選択には影響しません。

## Firestoreデータ構造

- `meta/items` — 全店共通の商品マスタ
- `meta/storeMaster` — 店舗一覧
- `storesConfig/{storeId}` — 店舗ごとの什器配置・スケジュール設定
- `storeStock/{storeId}` — 店舗ごとの現在の在庫数
- `dailyArchives/{storeId}_{date}` — 日別の調理/販売/廃棄集計
- `recordLog` — 調理/販売/廃棄の追記型イベントログ
- `manualBackups/{storeId}__{YYYY-MM-DD_HHMM}` — バックアップ(店舗ごとに直近7世代)

## 保存のしくみ

データは性質ごとに保存先とタイミングを分けています。

| 対象 | 保存先 | タイミング |
|---|---|---|
| 在庫数 | `storeStock` | 自動（最後の操作から10秒／画面切替時／アプリを閉じるとき） |
| 什器配置・スケジュール・店舗マスタ・商品マスタ | `storesConfig` `meta` | 手動（「保存」ボタン）＋変更がある状態での画面切替時 |
| 調理/販売/廃棄の記録 | `recordLog` `dailyArchives` | 操作の10秒後（失敗したら端末に残して再送信） |
| バックアップ | `manualBackups` | 手動（全店舗）＋その日の初回起動時に自動（この店舗のみ） |

在庫は1日に何百回も変わる一方、什器配置やスケジュールは月に数回しか変わりません。同じドキュメントに入れたままだと在庫を保存するたびに設定まで書き換えることになるため、保存先ごと分けています。

読み込みに失敗した状態では、いっさい保存を行いません（画面に出ている初期設定でクラウドの正しいデータを上書きしてしまうため）。同じ理由で、設定を読み込めていない店舗も保存の対象外です。

クラウドへ送れなかった記録は端末（localStorage）に残り、画面上部のバーで知らせます。電波が戻ると自動で送り直され、「🔄 今すぐ再送信」ボタンから手動でも送れます。
