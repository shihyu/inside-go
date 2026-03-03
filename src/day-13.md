# 第十三天：更多除錯訊息

- Day: 13
- 發佈日期: 2019-09-28
- 原文: [https://ithelp.ithome.com.tw/articles/10221931](https://ithelp.ithome.com.tw/articles/10221931)

### 前情提要

------------------------------------------------------------------------

昨日提到除錯選項的 `allocfreetrace`，但若要觀察 scheduler 行為，hw 範例還是太單薄了一些。

### `schedinit`

```go
 ...
    parsedebugvars()
    gcinit()

    sched.lastpoll = uint64(nanotime())
    procs := ncpu
    if n, ok := atoi32(gogetenv("GOMAXPROCS")); ok && n > 0 {
        procs = n
    }
    ...
```

#### 新的範例：multi-hw.go

為了展示 scheduler 真的有在忙，我們也因此必須準備比較有趣一點的範例。在這個範例當中，我們將令 `n` 個 goroutine 彼此之間達成總量 `n*(n-1)` 的訊息交流；只要需要切換這些 goroutine，scheduler 就必然會有用武之地了。

```go
import (
        //"fmt"                                                                                                                         
        "os"
        "strconv"
        "sync"
        "sync/atomic"
)       
        
func main() {
        n, _ := strconv.Atoi(os.Args[1])
        
        // Init the channels
        chans := make([][]chan uint32, n)
        shadow := make([]chan uint32, n*n)
        for i := 0; i < n; i++ {
                chans[i] = shadow[i*n : (i+1)*n]
                for j := 0; j < n; j++ {
                        chans[i][j] = make(chan uint32)
                }
        }

```
首先，直接用牛刀殺雞吧！直接宣告一個 `n*n` 的 channel 陣列，對於每一個符合 `0 <= i,j <= n` 且 `i != j` 的數對，`i` 傳訊給 `j` 的同步頻道就必須使用 `chans[i][j]`。然後，由於主要的 main routine 沒有參與，所以也要有個同步機制讓它等候所有的 goroutine 結束，就像 POSIX 的 wait 那樣：

```go
        // the ID of each go routine
        var id uint32
        // main thread waits for all goroutine
        var wg sync.WaitGroup
        wg.Add(n)
         
        for i := 0; i < n; i++ {
                go func() {
                        defer wg.Done()
                        myID := atomic.AddUint32(&id, 1) - 1
            ...
                }()
        }
        wg.Wait()                                                                                                                       
        time.Sleep(500 * time.Microsecond)
}

```
這裡我們使用 `sync.WaitGroup` 型別的同步物件 API，等待者需使用 `Add` 方法指定總共要等待多少個 goroutine 結束，而每一個 goroutine 則是需要呼叫 `Done` 方法表達自己已經結束。最後的 `time.Sleep` 只是一個保險，畢竟開啟除錯訊息之後還是有可能因為 main thread 離開而印到一半沒有下文。

這一段程式的另外一個重點是 ID。搜尋一下就會發現，其實 GO 語言社群是有意識地不希望 `goid` 這個資訊暴露在外，所以筆者這裡才會使用一個 atomic 操作來自己生成可供識別的 ID。

```go
                        var i uint32
                        for i = 0; i < myID; i++ {
                                // read from goroutine i
                                <-chans[i][myID]
                                // write to goroutine i
                                chans[myID][i] <- myID
                        }
         
                        for i = myID + 1; i < uint32(n); i++ {
                                // write to goroutine i
                                chans[myID][i] <- myID
                                // read from goroutine i
                                <-chans[i][myID]
                        }

```
迴圈的內層就是實際的交流功能。由於這裡 channel 只有預設的設定，也就是說，無論是讀取或是寫入，都會是 block 的狀態，一定要讀寫成對才能夠繼續運行下去。為了避免 deadlock，這裡的設定是將每一個 goroutine 的 `myID` 當作**輩分**，因此有順序性，讀者可以自行驗證。

> channel 不能像是 socket programming 一樣，就算兩端都先丟後收也能各自接收到訊息。但是還是有些進階用法能夠組合出 non-blocking 的功能，這裡就先不討論了。有興趣的讀者可以使用 select 當作關鍵字查查看。

那麼就是使用除錯選項 `schedtrace` 了：

```
$ GODEBUG=schedtrace=1 ./hw
SCHED 0ms: gomaxprocs=8 idleprocs=5 threads=5 spinningthreads=1 idlethreads=0 runqueue=0 [0 0 0 0 0 0 0 0]
Hello World!
$ GODEBUG=schedtrace=1 ./multi-hw 2048
SCHED 0ms: gomaxprocs=8 idleprocs=5 threads=5 spinningthreads=1 idlethreads=0 runqueue=0 [1 0 0 0 0 0 0 0]
SCHED 1ms: gomaxprocs=8 idleprocs=6 threads=5 spinningthreads=0 idlethreads=2 runqueue=0 [0 0 0 0 0 0 0 0]
SCHED 2ms: gomaxprocs=8 idleprocs=6 threads=5 spinningthreads=0 idlethreads=2 runqueue=0 [0 0 0 0 0 0 0 0]
SCHED 3ms: gomaxprocs=8 idleprocs=7 threads=5 spinningthreads=0 idlethreads=3 runqueue=0 [0 0 0 0 0 0 0 0]
SCHED 4ms: gomaxprocs=8 idleprocs=7 threads=5 spinningthreads=0 idlethreads=3 runqueue=0 [0 0 0 0 0 0 0 0]
...
SCHED 601ms: gomaxprocs=8 idleprocs=0 threads=9 spinningthreads=0 idlethreads=0 runqueue=0 [0 0 0 1 1 0 1 0]
SCHED 611ms: gomaxprocs=8 idleprocs=0 threads=9 spinningthreads=0 idlethreads=0 runqueue=0 [0 0 0 0 0 0 1 1]
SCHED 621ms: gomaxprocs=8 idleprocs=0 threads=9 spinningthreads=0 idlethreads=0 runqueue=0 [1 0 0 1 1 1 0 0]
SCHED 632ms: gomaxprocs=8 idleprocs=0 threads=9 spinningthreads=0 idlethreads=0 runqueue=0 [0 1 1 1 1 1 0 1]
SCHED 642ms: gomaxprocs=8 idleprocs=0 threads=9 spinningthreads=0 idlethreads=0 runqueue=0 [1 1 0 1 1 0 0 0]

```
不得不說這個結果還是讓人頗為困惑。`gomaxprocs=8` 是筆者的電腦的實體核心數，也是可以透過 `GOMAXPROCS` 環境變數設置可讓 GO 語言程式引用的一個值，這還好理解，但是 `idleprocs` 的增減或是歸零本身並沒有什麼資訊可言。thread 的部份也很令人疑惑 spinning 的定義是什麼？為什麼後三者加起來還不會等於總 thread 數呢？

所以其實就是情報太簡化了。繼續參考[除錯選項文件](https://golang.org/pkg/runtime/#pkg-overview)可以發現還有一個叫做 `scheddetail` 的選項，以 0 和 1 控制，而其實 `schedtrace` 的值是代表紀錄 scheduler 工作的時間間隔。開啟了之後大概會有類似以下的結果：

```
$ GODEBUG=schedtrace=10,scheddetail=1 ./multi-hw 2048 2>&1 | egrep "curg=[0-9]*|m=[0-9]|SCHED"
...
SCHED 564ms: gomaxprocs=8 idleprocs=0 threads=9 spinningthreads=0 idlethreads=0 runqueue=0 gcwaiting=0 nmidlelocked=0 stopwait=0 sysmonwait=0
  P0: status=1 schedtick=2651 syscalltick=9 m=0 runqsize=1 gfreecnt=2
  P1: status=1 schedtick=2915 syscalltick=6 m=5 runqsize=1 gfreecnt=0
  P2: status=1 schedtick=2487 syscalltick=6 m=4 runqsize=1 gfreecnt=0
  P3: status=1 schedtick=3072 syscalltick=0 m=8 runqsize=0 gfreecnt=0
  P4: status=1 schedtick=2690 syscalltick=0 m=6 runqsize=0 gfreecnt=8
  P5: status=1 schedtick=14185 syscalltick=0 m=7 runqsize=1 gfreecnt=0
  P6: status=1 schedtick=9973 syscalltick=0 m=3 runqsize=0 gfreecnt=12
  P7: status=1 schedtick=2270 syscalltick=0 m=2 runqsize=1 gfreecnt=0
  M8: p=3 curg=1714 mallocing=0 throwing=0 preemptoff= locks=0 dying=0 spinning=false blocked=false lockedg=-1
  M7: p=5 curg=790 mallocing=0 throwing=0 preemptoff= locks=1 dying=0 spinning=false blocked=false lockedg=-1
  M6: p=4 curg=753 mallocing=0 throwing=0 preemptoff= locks=0 dying=0 spinning=false blocked=false lockedg=-1
  M5: p=1 curg=274 mallocing=0 throwing=0 preemptoff= locks=0 dying=0 spinning=false blocked=false lockedg=-1
  M4: p=2 curg=217 mallocing=0 throwing=0 preemptoff= locks=1 dying=0 spinning=false blocked=false lockedg=-1
  M3: p=6 curg=795 mallocing=0 throwing=0 preemptoff= locks=1 dying=0 spinning=false blocked=false lockedg=-1
  M2: p=7 curg=276 mallocing=0 throwing=0 preemptoff= locks=0 dying=0 spinning=false blocked=false lockedg=-1
  M1: p=-1 curg=-1 mallocing=0 throwing=0 preemptoff= locks=1 dying=0 spinning=false blocked=false lockedg=-1
  M0: p=0 curg=1053 mallocing=0 throwing=0 preemptoff= locks=1 dying=0 spinning=false blocked=false lockedg=-1
  G142: status=2(chan send) m=5 lockedm=-1
  G962: status=2(chan receive) m=5 lockedm=-1
  G1022: status=2(chan receive) m=5 lockedm=-1
  G1096: status=2(chan send) m=0 lockedm=-1
  G1570: status=2(chan send) m=2 lockedm=-1
  G1799: status=2(chan receive) m=2 lockedm=-1
  G2075: status=2(chan send) m=6 lockedm=-1
SCHED 656ms: gomaxprocs=8 idleprocs=0 threads=9 spinningthreads=0 idlethreads=0 runqueue=0 gcwaiting=0 nmidlelocked=0 stopwait=0 sysmonwait=0
  P0: status=1 schedtick=4179 syscalltick=9 m=0 runqsize=0 gfreecnt=36
  P1: status=1 schedtick=4748 syscalltick=6 m=5 runqsize=1 gfreecnt=11
...

```
之所以使用 egrep 指令篩選輸出，是因為 multi-hw 範例其實執行得非常快，因此不得不開多一點 goroutine 來觀察行為；但真的有很多 goroutine 之後，印出 G 的行數又會大幅稀釋重要資訊。無論如何，從這些 trace 當中可以發現 P-M-G 之間的對應關係，但很難想像如何在真正的除錯過程中派上用場？

還有一個詭異的地方。如果只看 P 和 M 的話，可以看到它們之間還是有很一致的連結性，比方說 `M7` 的資料中存在一筆 `p=5`，而 `P5` 的資料裡面也有一筆 `m=7`；但如果以為這個案例可以通用到 G，那就想得太美好了，很明顯地在經過 egrep 的篩選之後，由於 `m=[0-9]` 的通用表示式條件，這裡已經篩出屬於特定 M （若是閒置的 goroutine 會被顯示為 `m=-1`）的 G 了，但其實他們與 M 的資料完全不一致。這又是為什麼？難道是為了不過份影響效能，因此在 trace 輸出時，整個 goroutine 的排程也繼續照常進行嗎？

#### 這些 trace 的設置

由於疑問實在太多，筆者決定再稍微深入一點，觀察這些除錯選項如何實際起作用；也就是說，它們如何被轉化成印出這些訊息的條件？這些印出的內容，又是從什麼樣的結構體當中撈取資訊的？

直接用 `debug.schedtrace` 當關鍵字搜尋整個 `src` 資料夾，可以得到以下結果：

```go
./runtime/runtime1.go:334:   {"scheddetail", &debug.scheddetail},
./runtime/runtime1.go:335:  {"schedtrace", &debug.schedtrace},
./runtime/panic.go:919:     if debug.schedtrace > 0 || debug.scheddetail > 0 {
./runtime/proc.go:4297:     if debug.schedtrace <= 0 && (sched.gcwaiting != 0 || atomic.Load(&sched.npidle) == uint32(gomaxprocs)) {
./runtime/proc.go:4367:     if debug.schedtrace > 0 && lasttrace+int64(debug.schedtrace)*1000000 <= now {
./runtime/proc.go:4369:         schedtrace(debug.scheddetail > 0)

```
前兩者是在 `parsedebugvars` 函式本體之前的定義所在之處。後面這幾項目就是我們要找的實際產生作用之處了。先看 panic 處理的條件，顯然是這兩個選項開啟時才會作用，

```go
 913         switch \_g\_.m.dying {  
 914         case 0:               
 915                 // Setting dying >0 has the side-effect of disabling this G's writebuf.
 916                 \_g\_.m.dying = 1
 917                 atomic.Xadd(&panicking, 1)
 918                 lock(&paniclk)
 919                 if debug.schedtrace > 0 || debug.scheddetail > 0 {
 920                         schedtrace(true)                                                                                           
 921                 }             
 922                 freezetheworld()

```
這是在 `startpanic_m` 函式之中的一個片段，*g* 這個 goroutine 所屬的 M 要進入 panic 狀態的其中一種情況。這裡呼叫的 `schedtrace` 函式應該就是我們要找的對象吧！果不其然：

```go
4504 func schedtrace(detailed bool) {
4505         now := nanotime()
4506         if starttime == 0 {
4507                 starttime = now
4508         }
4509        
4510         lock(&sched.lock)
4511         print("SCHED ", (now-starttime)/1e6, "ms: gomaxprocs=", gomaxprocs, " idleprocs=", sched.npidle, " threads=", mcount(), " s     pinningthreads=", sched.nmspinning, " idlethreads=", sched.nmidle, " runqueue=", sched.runqsize)
4512         if detailed {
4513                 print(" gcwaiting=", sched.gcwaiting, " nmidlelocked=", sched.nmidlelocked, " stopwait=", sched.stopwait, " sysmonw     ait=", sched.sysmonwait, "\n")
4514         }
4515         // We must be careful while reading data from P's, M's and G's.
4516         // Even if we hold schedlock, most data can be changed concurrently.
4517         // E.g. (p-\>m ? p-\>m-\>id : -1) can crash if p-\>m changes from non-nil to nil.
4518         for i, \_p\_ := range allp {

```
每一組 trace 的標題行以 `SCHED` 開頭的印出部份就在這裡確定了。這個註解也解答了我們前面的問題，那就是所有被讀取的資料都是同時在並行執行的；註解中並且舉了一個可能會招致程式 crash 的錯誤模式。這個片段之下有三組大迴圈，分別針對 `allp`、`allm` 以及 `allg`，就是我們都在前幾段看到的那樣了。

### 疑問

------------------------------------------------------------------------

- `schedtrace` 真的有實際用途嗎？用在何處？

### 本日小結

------------------------------------------------------------------------

原本打算要完成整個 `schedinit` 追蹤，結果光是 `schedtrace` 就看了很久啊。明日繼續努力！
