# 第十四天：schedinit 告一段落

- Day: 14
- 發佈日期: 2019-09-29
- 原文: [https://ithelp.ithome.com.tw/articles/10222350](https://ithelp.ithome.com.tw/articles/10222350)

### 前情提要

------------------------------------------------------------------------

原本打算昨日結束整個 `schedinit` 部份，但光是寫範例程式和追蹤其中的 P-M-G 關係就花了許多時間...

### `schedinit`

```go
 ...
    gcinit()

    sched.lastpoll = uint64(nanotime())
    procs := ncpu
    if n, ok := atoi32(gogetenv("GOMAXPROCS")); ok && n > 0 {
        procs = n
    }
    if procresize(procs) != nil {
                throw("unknown runnable goroutine during bootstrap")
        }
    ...
```

#### `gcinit` 函式（`runtime/mgc.go`）

GC（Garbage Collection）！這可以算是 C 母語的筆者覺得最魔幻的一個元件之一了。與其下來直接看程式，更有效的方式應該是先閱讀一些資料。筆者這裡推薦這些內容：

1.  [GO 語言與它的垃圾回收機制](https://www.slideshare.net/JorisBonnefoy1/go-and-the-garbage-collection)  
    這投影片雖然是英文的，但是有些圖例實在畫龍點睛。這裡推薦幾頁給各位讀者瀏覽：首先是第 7 頁的問題介紹，到第 10 頁為止展示一個簡單的記憶體操作範例，有個節點 A 原本連到節點 B，但後來又直接生成了一個新的節點 C 取代原本 B 所在的連結，B 節點的位址登時成為再也無法存取到的無主之地，這種情況就是 GC 必須出面處理的了，否則程式規模一大，這樣的案例要是全部不回收的話，再多的記憶體也不夠用。

接著是兩種派別的垃圾回收機制，reference counting 和 tracing。GO 語言採用的是屬於後者，從 21 頁開始。簡單看過描述之後可以跳到 27 頁，那裡描述 GO 語言採用的**三色方法**，非常有趣。簡單來說就是，整個可管理的記憶體空間相當於是彼此存取的物件所形成的一張有向圖。其中，所有的物件都可以被區分成三個不同的陣營；第一個是已經被掃描過、確定還在被使用的，這是白色；第二個是可以從黑色陣營物件透過指標存取得到、但是還沒被掃描到的物件，這是灰色；最後，已經完全失去存取手段的物件，是白色。

這個演算法就是不斷的從黑色陣營的物件中檢查它們存取得到的物件，並把屬於灰色陣營的物件吸納到黑色部份去。等到灰色集合空了之後，就可以確定白色集合是可以回收的物件了。

第 42 頁開始有 GO 語言垃圾回收機制的沿革。到 1.5 版之後的效能已經突飛猛進，STW 時間變得更少，且還有部份回收過程可以與應用程式一起並行。

2.  [Garbage Collection Sematics(GopherCon SG 2019)](https://www.youtube.com/watch?v=q4HoWwdZUHs)  
    這篇是今年新加坡 GopherCon 的演講，有非常口語且簡潔的說明，只有 25 分鐘長度，值得一看！影片中也有提到 `GODEBUG` 環境變數的垃圾回收選項，會紀錄每一次垃圾回收的一些資訊，有興趣的讀者不妨試試看吧！

#### 程式碼本身

整個 `mgc.go` 檔案的前面有很大篇幅的註解，從比較高層次的角度解釋 GC 在做什麼。有很多關鍵字：`tri-color`、`on-the-fly`、`mark-and-sweep` 之類，各自有各自的用意，在上一段介紹的演說影片中也都有大概提及。但由於 Mark 和 Sweep 兩個動作常常出現在程式碼中，這裡還是簡單說明一下。前段簡單描述過三色演算法的概念，那大致上就是 Mark 的部份，將各個記憶體物件標記起來；之後，只要根據標記回收即可，所以 Sweep 階段有很大比例都是可以與應用程式並行的。

```go
        if unsafe.Sizeof(workbuf{}) != _WorkbufSize {
                throw("size of Workbuf is suboptimal")
        }
        
        // No sweep on the first cycle.
        mheap_.sweepdone = 1
        
        // Set a reasonable initial GC trigger.
        memstats.triggerRatio = 7 / 8.0
        
        // Fake a heap_marked value so it looks like a trigger at
        // heapminimum is the appropriate growth from heap_marked.
        // This will go into computing the initial GC goal.
        memstats.heap_marked = uint64(float64(heapminimum) / (1 + memstats.triggerRatio))

```
`gcinit` 內其實主要就是一些初始化參數的設定。試想，從之前的資料推測的話，垃圾回收應該也是執行時完全獨立於使用者應用程式邏輯，依照某些我們目前尚且未知的條件所觸發的一種背景機制。所以若是將記憶體的配置與（使用垃圾回收機制）回收比喻作人體肌肉的充能與耗損過程、且將程式的執行比喻做一場賽跑的話，`gcinit` 就是在起跑點上蓄勢待發時的狀態而已。

第一組要確認的條件是 `workbuf` 的大小。可是這實在很奇怪，難道這種緩衝區大小不是應該隨著平台的大小而調整的嗎？但是兩個值都存在於 `runtime/mgcwork.go` 檔案中，都是由所有架構共用的。這個值是 2KB，有明確的定義

```go
const (  
        _WorkbufSize = 2048 // in bytes; larger values result in less contention     
         
        // workbufAlloc is the number of bytes to allocate at a time
        // for new workbufs. This must be a multiple of pageSize and
        // should be a multiple of _WorkbufSize.
        //
        // Larger values reduce workbuf allocation overhead. Smaller
        // values reduce heap fragmentation.
        workbufAlloc = 32 << 10
)

```
且將這部份留作疑問。接下來分別設置了 `mheap_` 與 `memstats` 的一些條件。其中 `mheap_sweepdone` 當然是一個標準的初始條件，因為最一開始，當然不應該有任何相當於 sweep 階段的回收工作。`memstats` 相關的兩個條件這裡就先放著，從註解中看來是與垃圾回收機制在每個觸發階段的工作目標有關。

剩下的 `gcinit` 部份：

```go
        // Set gcpercent from the environment. This will also compute
        // and set the GC trigger and goal.
        _ = setGCPercent(readgogc())
    ...
                  
func readgogc() int32 {
        p := gogetenv("GOGC")
        if p == "off" {
                return -1
        }         
        if n, ok := atoi32(p); ok {
                return n
        }         
        return 100
}

```
這個 `setGCPercent` 函式是極其重要的一個呼叫（位於 `runtime/mgc.go` 之中）。在這裡它先取得了來自 `GOGC` 環境變數的設置，通常這可以設置一個數值或是 `off` 代表關閉，預設是 `100`。因為整個觸發機制仰賴一個百分比的比率，`100%` 意味著原汁原味的預設值。至於是什麼的預設值？其實相關資訊就在 `gcinit` 上方不遠的註解：

```go
// During initialization this is set to 4MB*GOGC/100. In the case of
// GOGC==0, this will set heapminimum to 0, resulting in constant
// collection even when the heap size is small, which is useful for
// debugging.
var heapminimum uint64 = defaultHeapMinimum
 
// defaultHeapMinimum is the value of heapminimum for GOGC==100.
const defaultHeapMinimum = 4 << 20

```
也就是最小的 heap 記憶體量值的意思。相較於垃圾回收機制比值的相關註解，最後兩行顯得非常低調：

```
        ...          
        work.startSema = 1
        work.markDoneSema = 1
}                 

```
這個 `work` 是一個龐大的結構，定義在同一個檔案中，詳細內容就先略過了。這兩個成員變數的共同點在於後綴的 `Sema` 到底是指什麼？翻找了一下原始定義，原來是旗標（semaphore）：

```
        // startSema protects the transition from "off" to mark or
        // mark termination.
        startSema uint32
        // markDoneSema protects transitions from mark to mark termination.
        markDoneSema uint32

```
它們分別保護了垃圾回收過程中的一些狀態轉移的部份，這裡就提及了 `off`、`mark`、`mark termination` 等階段。同一個檔案之中還有 `gcStart` 之類的垃圾回收功能的核心函式，這裡就先不深入。

#### `gcinit `最後的一些部份

```go
        procs := ncpu
        if n, ok := atoi32(gogetenv("GOMAXPROCS")); ok && n > 0 {
                procs = n
        }
        if procresize(procs) != nil {
                throw("unknown runnable goroutine during bootstrap")
        }

```
使用者可以透過 `GOMAXPROCS` 控制 GO 程式所能使用的最多程序數量。在 `procresize` 函式中可以看到，

```go
// Change number of processors. The world is stopped, sched is locked.
// gcworkbufs are not being modified by either the GC or
// the write barrier code.
// Returns list of Ps with local work, they need to be scheduled by the caller.
func procresize(nprocs int32) *p {
        old := gomaxprocs
        if old < 0 || nprocs <= 0 {
                throw("procresize: invalid arg")
        }

```
GO 語言的三項之力 P-M-G 之中的 P 資源會在這裡變動，而我們這裡就是作為初始化之用。其後會為 `sched` 排程器設置一些參數，然後很大篇幅在處理 allp 這個全域變數。

### 疑問

------------------------------------------------------------------------

- 為什麼 `workbuf` 的大小綁定 2K 呢？
- `allp` 的處理是看到了，那 `allm` 和 `allg` 呢？

### 本日小結

------------------------------------------------------------------------

今日終於完結了 `schedinit` 的追蹤部份。明日開始我們就繼續往 `main` 函式前進吧！
