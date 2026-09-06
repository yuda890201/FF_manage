# FF_manage

## データ管理 (Firebase)

このアプリはFirebase Authentication(店舗番号PINコード方式)とCloud Firestoreでデータを管理しています。

- `index.html` 内の `firebaseConfig`(空欄)に、Firebaseコンソール「プロジェクトの設定」→「マイアプリ」で取得できる値を貼り付けてください。
- Firestore Security Rules(`firestore.rules`)は `main` ブランチへのpush時にGitHub Actionsで自動デプロイされます。デプロイには、リポジトリシークレット `FIREBASE_SERVICE_ACCOUNT`(サービスアカウントJSON)の登録、サービスアカウントへの `Service Usage Consumer` / `Firebase Rules Admin` ロールの付与、`.firebaserc` の `default` プロジェクトIDの設定が必要です。

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
