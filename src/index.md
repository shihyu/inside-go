# 入吾 Go 中：走訪 Go 語言內部實作

![系列封面](images/series-cover.jpg)

說到 Go 語言，你會想到什麼呢？
簡潔？美麗？強大？無所不在？從筆者的角度來看，這些都是 Go 語言的一些形容詞而已。
「存在先於本質」，可是，Go 語言到底是什麼？這個問題可能又不免太大了。
秉持著鐵人賽的精神，我們就從 Hello World 開始吧！在接下來的 30 天當中，筆者將使用靜態的 vim-go 與動態的 gdb 追蹤工具觀察 Go 語言程式，目標是理解重要標準函式庫的實作並妥善的解說給讀者；如果能夠來得及的話，也希望能夠涵蓋到其他面向，比方說 Go compiler 之類的。
讓我們一起努力吧！

來源：[https://ithelp.ithome.com.tw/users/20103524/ironman/2589](https://ithelp.ithome.com.tw/users/20103524/ironman/2589)

文章數：30

## 目錄

- [Day 01 第一天：本系列方向與寫作計畫](day-01.md)
- [Day 02 第二天：進入 Hello World!](day-02.md)
- [Day 03 第三天：追蹤 os.Stdout](day-03.md)
- [Day 04 第四天：拆解 Println](day-04.md)
- [Day 05 第五天：Fprintln 後半](day-05.md)
- [Day 06 第六天：暫停一下回顧未解問題](day-06.md)
- [Day 07 第七天：瀏覽系統相依的初始化](day-07.md)
- [Day 08 第八天：進入 schedinit](day-08.md)
- [Day 09 第九天：進入 schedinit （之二）](day-09.md)
- [Day 10 第十天：初遇 GO 語言密碼：G、M、P？](day-10.md)
- [Day 11 第十一天：繼續奮戰 schedinit](day-11.md)
- [Day 12 第十二天：簡單除錯 GO 語言程式](day-12.md)
- [Day 13 第十三天：更多除錯訊息](day-13.md)
- [Day 14 第十四天：schedinit 告一段落](day-14.md)
- [Day 15 第十五天：追蹤 newproc](day-15.md)
- [Day 16 第十六天：newproc1 之前的堆疊準備動作](day-16.md)
- [Day 17 第十七天：看看 systemstack 函式呼叫](day-17.md)
- [Day 18 第十八天：GO 語言運行模型的三項之力](day-18.md)
- [Day 19 第十九天：G 的取得路徑](day-19.md)
- [Day 20 第二十天：新生 goroutine 的初始狀態](day-20.md)
- [Day 21 第二十一天：配置新的 goroutine](day-21.md)
- [Day 22 第二十二天：領取號碼牌](day-22.md)
- [Day 23 第二十三天：開始排隊](day-23.md)
- [Day 24 第二十四天：上膛的 goroutine](day-24.md)
- [Day 25 第二十五天：minit 與 signal 設置](day-25.md)
- [Day 26 第二十六天：signal 初始化收尾](day-26.md)
- [Day 27 第二十七天：goroutine 執行中](day-27.md)
- [Day 28 第二十八天：其他的 M 登場](day-28.md)
- [Day 29 第二十九天：終點的 main.main](day-29.md)
- [Day 30 第三十天：繼續前進](day-30.md)
