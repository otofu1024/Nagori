---
title: Nagori 表示確認
description: このFront Matterは原文のまま表示されます
---

# Nagori 表示確認

このファイルは閲覧・編集の確認用です。コピーして自由に編集できます。
プレビューを確認するときは、カーソルを対象の式や装飾から外してください。

## Markdownの基本

日本語の文章と **太字**、*斜体*、~~取り消し線~~、`インラインコード`。

- 箇条書き
  - 入れ子の項目
- [ ] 未完了のタスク
- [x] 完了したタスク

1. 最初の項目
2. 次の項目

> 引用の文章です。
> 日本語入力中も、ほかの箇所のプレビューが維持されるか確認できます。

| 項目 | 内容 |
| --- | --- |
| 文章 | **装飾付きのセル** |
| 数式 | $\sqrt{x^2+y^2}$ |

```typescript
const message = "コード内の $x^2$ は数式にしない";
```

---

## インライン数式

二次方程式の解は $x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}$ です。

別の区切り方も使えます：\(\alpha + \beta = \gamma\)。

価格は \$5、\$10。ここではドル記号を表示します。

## 表示式

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

\[
\sum_{k=1}^{n} k = \frac{n(n+1)}{2}
\]

## 行列・場合分け・複数行

$$
A = \begin{pmatrix}
1 & 2 \\
3 & 4
\end{pmatrix}
$$

$$
|x| = \begin{cases}
x & x \ge 0 \\
-x & x < 0
\end{cases}
$$

$$
\begin{aligned}
(a+b)^2 &= a^2 + 2ab + b^2 \\
\nabla \cdot \mathbf{E} &= \frac{\rho}{\varepsilon_0}
\end{aligned}
$$

## 式番号・前方参照

次の式は $\eqref{eq:energy}$ です。番号への参照が先にあっても表示します。

$$
\begin{equation}
E = mc^2 \label{eq:energy}
\end{equation}
$$

明示的なタグも使えます。

$$
\begin{equation}
\mathcal{L}(\theta) = -\sum_{i=1}^{N}\log p_\theta(x_i)
\tag{A}\label{eq:loss}
\end{equation}
$$

上の損失関数は式 $\eqref{eq:loss}$ です。

## 記事内のマクロ

$$
\newcommand{\RR}{\mathbb{R}}
x \in \RR^n
$$

後の式でも $y \in \RR^m$ として使えます。

$$
\begin{multlined}
a+b+c+d \\
= e+f+g+h
\end{multlined}
$$

## 引用・リスト内の数式

> $$
> \frac{a}{b} + \frac{c}{d}
> $$

- リスト内の表示式

  $$
  z^2 = x^2 + y^2
  $$

## 原文を維持する内容

`$x^2$` はインラインコードなので数式にはしません。

```latex
\frac{1}{2}
```

<div>Raw HTML内の $x^2$ はHTMLや数式として描画しません。</div>

以下の未対応命令は、原文と数式エラーを表示します。

$$
\unknownNagoriCommand{x}
$$

## 編集の確認

この段落で日本語を入力し、変換中も上の数式や装飾が維持されるか確認できます。
Live Previewでは、数式をクリックするとLaTeX原文を編集でき、別の段落へ移動すると表示に戻ります。
Previewでは、選択やクリックをしても閲覧表示を維持し、本文を編集できません。
