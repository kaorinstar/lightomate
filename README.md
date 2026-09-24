# Lightomate

Lightomate（ライトメイト）は、Web 上の操作を自動化する Chrome 拡張機能（Manifest V3）です。
名称は Light、Automate、Mate を組み合わせたものです。

ログイン済みの Chrome の画面をそのまま使い、ページの要素を直接操作するため、Power Automate for
desktop より軽く動作します。Chrome ウェブストアでは公開せず、デベロッパーモードで読み込んで
個人で使います。

現在は開発の初期段階で、Chrome に読み込めますが、使える機能はまだありません。予定している機能と
進捗は https://github.com/kaorinstar/lightomate/issues で管理しています。

## 読み込み方

1. このリポジトリを ZIP でダウンロードして展開するか、複製（clone）します。
2. Chrome で chrome://extensions を開きます。
3. 右上の［デベロッパー モード］を有効にします。
4. ［パッケージ化されていない拡張機能を読み込む］を押し、`extension` フォルダーを選びます。
   リポジトリのフォルダー全体ではなく、その中の `extension` フォルダーです。
5. ツールバーの Lightomate のアイコンを押すと、画面の右側にサイドパネルが開きます。

Chrome 116 以降が必要です。

## 更新のしかた

新しい版を、前と同じ場所の `extension` フォルダーに上書きします。その後、chrome://extensions の
Lightomate の［再読み込み］ボタンを押します。

作成したフローは、フォルダーの場所を変えても失われません。拡張機能の ID を固定しているためです。
ただし、chrome://extensions で拡張機能を［削除］すると、保存したフローも削除されます。
