# FF_manage

## データ管理 (Firebase)

このアプリはFirebase Authentication(メール/パスワード)とCloud Firestoreでデータを管理しています。

- `index.html` 内の `firebaseConfig`(空欄)に、Firebaseコンソール「プロジェクトの設定」→「マイアプリ」で取得できる値を貼り付けてください。
- ログインには、Firebase Authenticationの「Users」タブで発行したメールアドレス・パスワードを使用します。
- Firestore Security Rules(`firestore.rules`)は `main` ブランチへのpush時にGitHub Actionsで自動デプロイされます。デプロイには、リポジトリシークレット `FIREBASE_SERVICE_ACCOUNT`(サービスアカウントJSON)の登録、サービスアカウントへの `Service Usage Consumer` / `Firebase Rules Admin` ロールの付与、`.firebaserc` の `default` プロジェクトIDの設定が必要です。

## Firestoreデータ構造

- `meta/items` — 全店共通の商品マスタ
- `meta/storeMaster` — 店舗一覧
- `storesConfig/{storeId}` — 店舗ごとの什器配置・在庫・スケジュール設定
- `dailyArchives/{storeId}_{date}` — 日別の調理/販売/廃棄集計
- `recordLog` — 調理/販売/廃棄の追記型イベントログ
- `manualBackups/{storeId}` — 手動バックアップ(1世代分)
