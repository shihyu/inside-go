# 第一天：本系列方向與寫作計畫

- Day: 1
- 發佈日期: 2019-09-16
- 原文: [https://ithelp.ithome.com.tw/articles/10215966](https://ithelp.ithome.com.tw/articles/10215966)

### 開場介紹

------------------------------------------------------------------------

GO 語言是由 [Rob Pike](https://zh.wikipedia.org/wiki/%E7%BE%85%E5%8B%83%C2%B7%E6%B4%BE%E5%85%8B) 與 [Ken Tompson](https://zh.wikipedia.org/wiki/%E8%82%AF%C2%B7%E6%B1%A4%E6%99%AE%E9%80%8A) 兩位 UNIX 作業系統開發者於 2009 九年開始發起的一項開放原始碼計畫。這些主力開發者們大幅引用過去的經驗設計出這個新的語言，具有以下特性：

- 強型別、編譯型語言：效能佳
- 有垃圾回收機制：不需要操煩容易出 bug 的記憶體管理
- 部署簡單快速：預設靜態連結
- 明確規定語言風格典範：不易出現社群聖戰
- 內建測試框架
- 內建同步性操作
- 民主且活躍的社群經營

GO 語言在 2013 年 [docker 專案](https://www.docker.com/)問世之後獲得空前的成功；2016 年獲得 TIOBE 指數給予年度最佳程式語言獎項；現在的殺手級應用 [K8S](https://kubernetes.io/docs/concepts/overview/what-is-kubernetes/)更是所有 IT 人員都感興趣的強大工具。這都顯示使用 GO 語言建構大型系統的便利與快捷。

所以筆者這次的鐵人賽挑戰要帶給 IT 邦幫忙的網友們一串 GO 語言的教學文...嗎？且先讓我們回顧歷年鐵人賽有哪些 GO 語言相關的文章吧：

- [2014年：初學 GO 30天](https://ithelp.ithome.com.tw/users/20079210/ironman/721)
- [2017年：30 天就 GO：教你打造 LINE 自動回話機器人](https://ithelp.ithome.com.tw/users/20103452/ironman/1211)
- [2018年：勇闖江湖身背三隻刀 GoGoGolang 系列](https://ithelp.ithome.com.tw/users/20107431/ironman/1352)

就連今年目前也已經至少有以下幾篇

- [Let's Eat GO ! 實務開發雜談by Golang](https://ithelp.ithome.com.tw/users/20080192/ironman/2194)
- [30天學會Golang](https://ithelp.ithome.com.tw/users/20119741/ironman/2517)
- [BeeGo](https://ithelp.ithome.com.tw/users/20012434/ironman/2678)
- [下班加減學點Golang與Docker](https://ithelp.ithome.com.tw/users/20104930/ironman/2647)

所以，不管是語言的學習本身或是語言的應用面，我們都已經有了這些前人的教學，那麼筆者又何必多此一舉重新分享安裝、Hello World、語法、演算法簡單實作、小型專案...的流程呢？因此，筆者決定探究的主題是至今比較少網友曾經訂過得目標，也就是研究** GO 語言是如何實作出來的？**  
如此一來與前人的努力便不顯重複，也能夠提供其他的資訊。

> 然而，難道這個題目就真的那麼新鮮嗎？也不盡然。今年的 COSCUP 就有一位 Ken-Yi Lee 大大給了一個演講[「從原始碼看 GO 語言的排程與實現」](https://docs.google.com/presentation/d/e/2PACX-1vSOpX-sZT_54NdnngdtaJUwnQjoVvju45oS-sIGHcnzhX_LTMb7KHVa7lCJIrx2qZewdA43pI8jALgl/pub?fbclid=IwAR1ASDyH7IdTL95VFUK-5NFz7NKdX8nXy4qDhl32nD1iyH4m6CDcHpw6Das&slide=id.g4da817b804_3_88)，條理分明，推薦各位讀者閱讀！但是筆者是比較土法煉鋼的方式在且戰且走，與往年的風格不會相去太遠。

### 寫作計畫

------------------------------------------------------------------------

其實筆者也是且戰且走的在準備這系列，對筆者來說這是全新的挑戰，內心也是非常期待。雖然根據往年經驗，預先建立目標也不一定能夠成功符合預期地完成，但這裡還是列出以下幾個大方向：

1.  基本架構：一個 GO 語言的 Hello World 會變成什麼樣子？怎麼變的？記憶體 layout 是怎麼樣？參數怎麼傳遞？
2.  map 與 slice 等複合式資料型別的實作
3.  goroutine 與 channel 等同步性的實作
4.  compiler 與 linker 等工具鏈的實作
5.  架構相依性的移植部份的實作

這些題目都非常大，承諾要將之全部完成顯然不切實際，因此實際進度會隨著寫作情況調整，還請各位網友海涵！但筆者承諾絕對盡筆者所能來探究 GO 語言的核心實作。當然，這系列也不能為了 GO 語言初學者從零開始，所以目標客群有一些基本條件：

- 有過一些 GO 語言經驗
- 如果完全沒有，至少要有一門精熟的程式語言
- 讀過「Binary Hacks」或是「程式設計師的自我修養」之類的書者佳

### 環境架設

------------------------------------------------------------------------

為了讓有興趣的讀者諸君能夠一同體會這個主題的樂趣，筆者在這開張的第一日就一起介紹所需要的開發環境。首先複製專案：

```
$ git clone https://github.com/golang/go.git
$ cd go
$ GOOS=Linux GOARCH=amd64 ./make.bash

```
> 請視情況調整所需指定的作業系統與處理器架構。

如此一來我們就有一個實驗用的 GO 語言環境啦！明天將開始我們的追蹤之旅，各位讀者我們明日再會！
