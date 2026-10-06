# Nagoriサイドバーカード画像

## 出力

| ファイル | 大きさ | 容量 |
| --- | --- | --- |
| `/private/tmp/nagori-card-art/sidebar-card-light.png` | 528×672 px | 328,540 bytes（約321 KB） |
| `/private/tmp/nagori-card-art/sidebar-card-dark.png` | 528×672 px | 349,591 bytes（約341 KB） |

画像はどちらも長方形です。文字を入れず、左上から左中央に文字を重ねる余白を残しました。各テーマの生成は1回で、生成し直した回数はそれぞれ0回です。

## 使ったプロンプト

ライト用には、`ui-reference.png`と`brand-reference.png`を参考画像として渡しました。

> Create a finished image asset for a narrow portrait macOS Markdown editor sidebar card, no UI mockup. Use the two supplied images only as visual references: image 1 shows the sidebar card composition in its lower left; image 2 shows Nagori's standalone N glyph and its brand colors. Make a LIGHT THEME version. Full bleed rectangular canvas, portrait aspect ratio 11:14 (target will be 528x672). Background pure soft white grading very subtly into pale ice blue toward the right and lower edge. The upper left through middle left, approximately x=0–65% and y=0–70%, must stay quiet, nearly blank, low contrast, and suitable for dark text overlay. On the right and lower edge, a single broad elegant folded 3D ribbon/wave in mint, turquoise, and light sky blue, flowing in from the right side and sweeping across the bottom; soft smooth gradients and gentle translucent depth, like the reference card. Place a small standalone Nagori N glyph at bottom left, around x=15% y=83%, sized about 16% of canvas width: navy left vertical stem, ribbon-shaped descending diagonal and right stem in gradient from mint to cyan, strongly resembling the Glyph example in image 2. Keep glyph distinct and legible against the light base. Premium restrained product illustration, smooth gradients, crisp silhouette, no texture, no noise, no fine patterns. Absolutely no text, letters other than the single N brand glyph, numbers, labels, watermark, border, rounded corners, shadows, or cards within cards.

ダーク用には、生成したライト用の原画を参考画像として渡しました。

> Create the DARK THEME companion to the supplied light Nagori sidebar card artwork. Preserve the exact portrait composition, layout, ribbon wave silhouette, ribbon placement, small bottom-left N glyph placement and N shape. Change the nearly white/light ice blue base to a smooth deep navy #132031 at top/left grading subtly to a slightly brighter navy #20334a at lower/right. Keep the upper left through middle left clear and quiet for white text overlay. Keep the N glyph's dark navy stem but give it a subtle bright rim or local light contrast so it remains legible on the navy base; preserve its mint-to-cyan ribbon diagonal. Keep the right and lower ribbon waves mint, turquoise and sky blue, perhaps gently luminous against the dark base, with smooth soft 3D depth. No text, words, numbers, labels, watermark, texture, grain, patterns, rounded corners, border, or shadow. Full bleed rectangular portrait illustration, aspect ratio 11:14.

## 参考画像との差

参考画像のカードには文字と角丸があります。生成画像では文字を外し、角丸も付けていません。右側の波は参考画像より面積がやや大きく、上端からも見えます。Nの形と配色はブランド資料のグリフに寄せていますが、完全な複製ではありません。ダーク用では背景を紺に変え、Nの輪郭と波を明るくしています。
