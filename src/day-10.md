# 第十天：初遇 GO 語言密碼：G、M、P？

- Day: 10
- 發佈日期: 2019-09-25
- 原文: [https://ithelp.ithome.com.tw/articles/10220699](https://ithelp.ithome.com.tw/articles/10220699)

### 前情提要

------------------------------------------------------------------------

昨日追蹤排程初始化（`runtime.schedinit`）函式內容，多閱讀了 `tracebackinit` 函式（與追溯 stack 機制有關的初始化，其實就是將一個 `skipPC` 變數初始化）、`moduledaraverify` 函式（函式 symbol、檔案、記憶體位址之間的啟動時檢查）還有 `stackinit` 函式。

### 接續的 `runtime.schedinit` （在 `src/runtime/porc.go` 之中）

------------------------------------------------------------------------

```go
func schedinit() {
    ...
    mallocinit()
    mcommoninit(_g_.m)
    cpuinit()       // must run before alginit
    ...
```

#### `mallocinit` （`src/runtime/malloc.go`）

檔案一開始就長達一百多行的註解在解釋整個 GO 語言的記憶體分配器是怎麼運作的。除此之外，還有關於 GO 語言的 Virtual Menory 配置的解說。這個部份由於之後顯然有機會重新造訪，所以大部分的細節也先跳過，只稍微看看這個函式的核心內容：

```go
func mallocinit() {
    // 錯誤檢查
    ...

    // Initialize the heap.
    mheap_.init()
    _g_ := getg()
    _g_.m.mcache = allocmcache()

    // 依作業系統不同而做的額外 hint 機制
    ...
```

`mheap_` 是 `mheap` 結構的一個成員，它掌管 `malloc` 所需要使用到的 heap 空間，以 8 KB 為單位；`mcache` 也是一種結構，用來代表每個核心使用的記憶體。

#### `mcommoninit` （一樣在 `src/runtime/proc.go`）

一開始就讓人覺得很蹊蹺，

```go
func mcommoninit(mp *m) {
    _g_ := getg()

    // g0 stack won't make sense for user (and is not necessary unwindable).
    if _g_ != _g_.m.g0 {
        callers(1, mp.createstack[:])
    }
    ...
```

稍微回顧一下，這個 `mcommoninit` 函式本身就是第一個使用到 `_g_`，也就是當前 goroutine 指標當作參數的的函式（而那個 `_g_` 是最一開始在 `schedinit` 函式裡面被呼叫的），但是一進來之後就又立刻呼叫了 `getg` 函式，是否表示 `mcommoninit` 函式除了在一般程序開始時使用，也在其他時候使用呢？稍微 grep 一下，果然在一個名叫 `allocm` 的函式也有使用到 `mcommoninit`。

至於參數型別的 `m`（這種極簡型別命名法如果來多了會非常困擾，幸好目前為止只有 `g` 和 `m`），可以從 `src/runtime/runtime2.go` 裡面找到端倪。`g` 具有一個型別為 `m` 的成員，解釋上面只有說是**當前的 m**，資訊並不多；但是 `m` 具有三個型別為 `g` 的成員，分別是 `g0`（負責 scheduling 的那個 goroutine）、`gsignal`（負責信號處理） 以及 `curg`（正在運行的這個）。

回到這裡節錄的程式碼。如果此時取得的 `_g_` 不同於 `g0` 的話，就要呼叫 `caller` 函式。這個 `caller` 函式結果會呼叫到我們之前曾在探討 `tracebackinit` 時遇到的一個大型函式，主要用意應該就是要在**錯誤的時候回報呼叫過程**吧。

#### 標記編號

```go
 ...
    lock(&sched.lock)
    if sched.mnext+1 < sched.mnext {
        throw("runtime: thread ID overflow")
    }
    mp.id = sched.mnext
    sched.mnext++
    ...
```

這一段的主角仍然是是傳進來的 `mp`：這個函式的 `m` 型別結構參數。一開使用 `sched.lock` 將整個區段鎖成 critical section，因為裡面的內容會修改到 `sched` 本體的緣故； `sched` 變數本身是 `schedt` 型別（定義在 `runtime/runtime2.go` 裡面）的一個變數。這裡顯示的是 `mnext` 這個既可以當作**目前為止創建的 m 的數量**也可以當作**下一個 m 的 ID** 的量，如何被使用及維持一致性。

#### 

```go
 mp.fastrand[0] = 1597334677 * uint32(mp.id)
    mp.fastrand[1] = uint32(cputicks())
    if mp.fastrand[0]|mp.fastrand[1] == 0 {
        mp.fastrand[1] = 1
    }

    mpreinit(mp)
    if mp.gsignal != nil {
        mp.gsignal.stackguard1 = mp.gsignal.stack.lo + _StackGuard
    }
```

前半段與亂數較有關係，但是機制上筆者完全無從猜測起，因只加到疑問中。

`mpreinit` 函式則是在 `runtime/os_linux.go` 中，

```go
// Called to initialize a new m (including the bootstrap m).
// Called on the parent thread (main thread in case of bootstrap), can allocate memory.
func mpreinit(mp *m) {
    mp.gsignal = malg(32 * 1024) // Linux wants >= 2K
    mp.gsignal.m = mp
}
```

這個呼叫透過 `malg` 函式配置了一個新的 gorotine 作為 `mp` 的 `gsignal` 成員。

#### 垃圾蒐集機制初登場

```go
 // Add to allm so garbage collector doesn't free g->m
    // when it is just in a register or thread-local storage.
    mp.alllink = allm
```

這一段只能算是先由註解的說明獲得一些線索，顯然 GO 的垃圾收集機制有可能會將當前的 `m` 整個回收掉，所以這裡將 `allm` 變數賦值予它。

之後的內容與 cgo、作業系統相依的部份有關，因此現在就先加到疑問章節中，留待日後探索。

#### `cpuinit` 函式（同樣在 `runtime/proc.go`）

沒什麼有趣的，主要是各種不同架構的 CPU 本身就會有各種擴充搭配。比方說同樣是 intel 的 CPU，有些強一點的伺服器 CPU 可能同時具有向量運算指令集和虛擬化指令集，但是文書筆電用的 i3 可能就沒有。

但是在爬梳部份程式碼時發現了 `runtime/proc.go` 裡面，由開發者給的最大的禮物：鳥瞰式的架構註解！在開頭的部份：

```go
// Goroutine scheduler
// The scheduler's job is to distribute ready-to-run goroutines over worker threads.
//
// The main concepts are:
// G - goroutine.
// M - worker thread, or machine.
// P - processor, a resource that is required to execute Go code.
//     M must have an associated P to execute Go code, however it can be
//     blocked or in a syscall w/o an associated P.
//
// Design doc at https://golang.org/s/go11sched.
```

所以之前都誤會了 `m` 以為是記憶體的意思，結果原來是抽象意義的**機器**，表現在可以動態排程的 goroutine 上面的話，也就是 **worker thread** 的意思了。`p` 這個抽象結構我們之前尚未遇過，但總之就是**處理器**本身的意思。

### 疑問

------------------------------------------------------------------------

- 記憶體初始化的細節？
- 亂數為何需要在程序啟動的早期設置？ `fastrand` 的用意為何？ 為何選定特殊的魔術數字 `1597334677`？
- stackguard 顧名思義是 stack 的保護機制，GO 如何實作這個功能？
- GC 如何影響 `m` 與 `g` 的運作？
- `g` 和 `p` 之間的關係？

### 本日小結

------------------------------------------------------------------------

追蹤 `schedinit` 的過程跌跌撞撞，疑問越積越多......但學習本來就是如此！累積夠多常識之後就能夠轉換成知識了吧！無論如何，我們明日再會！
