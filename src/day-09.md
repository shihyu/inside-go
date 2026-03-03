# 第九天：進入 schedinit （之二）

- Day: 9
- 發佈日期: 2019-09-24
- 原文: [https://ithelp.ithome.com.tw/articles/10220258](https://ithelp.ithome.com.tw/articles/10220258)

### 前情提要

------------------------------------------------------------------------

昨日剛開始追蹤排程初始化（`runtime.schedinit`）函式的開頭部份，註解真的幫了大忙；大略上瀏覽過一些觀念，比方說 goroutine 的存在。

### 接續的 `runtime.schedinit` （在 `src/runtime/porc.go` 之中）

------------------------------------------------------------------------

```go
...
    sched.maxmcount = 10000

    tracebackinit()
    moduledataverify()
    stackinit()
    mallocinit()
    mcommoninit(_g_.m)
...
```

先截個七行，因為筆者也沒有把握今天可以追蹤多遠，總之先列出這五個接下來的呼叫吧！之所以選到這裡，是因為昨日我們很努力觀察 `getg` 函式，而它所回傳的 `_g_` 第一次派上場的地方，就是這裡最後一行的 `mcommoninit`，這個該怎麼顧名思義呢？`Memory common init` 的意思嗎？沒關係，讓我們繼續看下去。

#### `tracebackinit`

筆者慢慢開始覺得亂猜很有趣，所以這裡也直接猜猜看。**筆者猜想** trace back 應該類似 kernel 出問題時的 dump stack 機制，或者 gdb 裡面也有一個 backtrace 指令可以將目前為止的 call stack 展示出來看。 GO 語言也和 Python 一樣有在出錯時自動回溯 call stack 的機制，比方說如果我們使用這個程式碼片段：

```go
a := make([]int, 1)
a[1] = 1
```

到時就會有錯誤輸出類似：

```
panic: runtime error: index out of range

goroutine 1 [running]:
main.main()
        /home/noner/FOSS/2019ITMAN/go_internal/hw.go:8 +0x11

```
> 讀者可以參考下面引用的程式碼片段的上面有一大段註解，明確指出這份 GO 源碼檔案就是在實作通用的 stack trace 機制。同時還有一些關於回傳位址屬於 stack 存放或暫存器存放的分類細節，這裡就暫不深入。

不管怎麼樣，這個函式在 `src/runtime/traceback.go` 裡面：

```go
...
var skipPC uintptr

func tracebackinit() {
    // Go variable initialization happens late during runtime startup.
    // Instead of initializing the variables above in the declarations,
    // schedinit calls this function so that the variables are
    // initialized and available earlier in the startup sequence.
    skipPC = funcPC(skipPleaseUseCallersFrames)
}
...

```
這個註解解釋的是另外一件事情：**GO 語言的變數初始化在 runtime 初始化的晚期（下暫略）**。可是這又甘 traceback 的功能什麼事呢？所以後面三行才道出原因。如果放在函式外初始化，就可能會沒有辦法在需要的時候盡早開始使用 `skipPC` 這個變數，所以乾脆直接讓 `schedinit` 早一點呼叫這個 `tracebackinit` 函式。那麼，這個希望可以被越早使用越好的 `skipPC` 是什麼東西呢？

筆者稍微搜查一下發現這個變數只在 `src/runtime/traceback.go` 以及 `src/runtime/symtab.go` 裡面有使用到。但相關的邏輯對於這時候我們所掌握的資訊而言實在太少了，應該先行跳過。我們之後可以使用比較大一點的函式，若有比較深的 call stack，應該可以更方便觀察相關的行為。至於賦值的 `funcPC` 函式是一個使用到 `unsafe` 指標存取的函式，用來取得傳入的函式的進入點，大致上類似在 C 裡面直接對函數取指標；其傳入參數為 `skipPleaseUseCallersFrames`，在 `x86_64` 的實驗平台上反組譯後發現裡面都是 `nop`，詳情待解。

#### `moduledataverify` （在 `src/runtime/symtab.go` 之中）

```go
func moduledataverify() {
    for datap := &firstmoduledata; datap != nil; datap = datap.next {
        moduledataverify1(datap)
    }
}
```

這是一個從 `firstmoduledata` 這個物件開始瀏覽到最後的一個迴圈。這個物件的定義是：

```go
var firstmoduledata moduledata  // linker symbol
```

而這個 `moduledata` 具備良好的說明：

```go
// moduledata records information about the layout of the executable
// image. It is written by the linker. Any changes here must be
// matched changes to the code in cmd/internal/ld/symtab.go:symtab.
// moduledata is stored in statically allocated non-pointer memory;
// none of the pointers here are visible to the garbage collector.
type moduledata struct {
    pclntable    []byte
...
```

從這個部份的功能在 `symtab.go` 這件事情看來，原來 `moduledata` 這個結構是 linker 用來紀錄整個執行檔內部的排列方式的東西，而且這個部份的記憶體是垃圾回收機制無法插手的靜態區域。定睛一看，其實 `pclntable` 這個成員變數陣列有點眼熟對吧？因為在第六日，我們就發現了執行檔裡面有個 `.gopclntab` 區段，看來就是 linker 生成 ELF 時的實際操作了。

至於迴圈內的 `moduledataverify1` 函式呼叫，邏輯還是很複雜，應該是要驗證些 symbol 與位置之間的關係的樣子，因為有一些錯誤訊息像是**不合法的 symbol table**、**未依照 PC 位址排序的函式 symbol table**。其實在這附近有說明 function table 的資料結構的設計理念，但是這就等到之後再來探究吧。

#### `stackinit`（在 `src/runtime/stack.go` 中）

```go
func stackinit() {
    if _StackCacheSize&_PageMask != 0 {
        throw("cache size must be a multiple of page size")
    }
    for i := range stackpool {
        stackpool[i].init()
    }
    for i := range stackLarge.free {
        stackLarge.free[i].init()
    }
}
```

`throw` 顯然是一種印出錯誤訊息且不回傳的那種程式結束點，順便兼當註解用，非常清楚。這個資格審核通過之後，就是針對 `stackpool` 以及 `stackLarge.free` 這兩個變數的初始化。這兩個變數其實都是同一個型別，參看他們的定義：

```go
// Global pool of spans that have free stacks.
// Stacks are assigned an order according to size.
//     order = log_2(size/FixedStack)
// There is a free list for each order.
// TODO: one lock per order?
var stackpool [_NumStackOrders]mSpanList
var stackpoolmu mutex

// Global pool of large stack spans.
var stackLarge struct {
    lock mutex
    free [heapAddrBits - pageShift]mSpanList // free lists by log_2(s.npages)
}
```

還蠻興奮這裡看到一個 `TODO`，因為也許之後有空可以來學著送送看 patch。總之這兩個變數都是 `mSpanList` 的陣列型別，它的 `init` 方法在 `src/runtime/mheap.go` 裡面：

```go
// Initialize an empty doubly-linked list.
func (list *mSpanList) init() {
    list.first = nil
    list.last = nil
}
```

總之，初始化就是這麼回事吧。但是 heap 專指動態配置的那些記憶體，這部份真正的管理方法，就也留到有空的時候再探討吧。

### 疑問

------------------------------------------------------------------------

- `skipPC` 的具體用途？
- GO 語言抽象了所有不同架構，仍然保持 `PC`、`SP`、`FP`、`LR` 等關鍵抽象暫存器，這些對於整個 stack trace 功能的具體實作為何？
- goroutine 的構成，顯然是理解 GO 語言的關鍵。 `g0` 和 `gsignal` 分別是怎麼來的？如何生成或指派的？
- moduledata 有沒有別的意思？就是 symbol table 而已嗎？
- 在 `heap.go` 裡面看到很多 heap 的管理都有強調**不能使用 heap 來管理 heap**，這如何作到？

### 本日小結

------------------------------------------------------------------------

繼續往後看 `schedinit` ，多走了三個初始化的部份，也都先在筆者認為適合的部份打住。明天再繼續看下去！各位讀者，我們明天再會！
