# FF_manage

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
- `storesConfig/{storeId}` — 店舗ごとの什器配置・在庫・スケジュール設定
- `dailyArchives/{storeId}_{date}` — 日別の調理/販売/廃棄集計
- `recordLog` — 調理/販売/廃棄の追記型イベントログ
- `manualBackups/{storeId}` — 手動バックアップ(1世代分)
