# 第二十二天：領取號碼牌

- Day: 22
- 發佈日期: 2019-10-07
- 原文: [https://ithelp.ithome.com.tw/articles/10225609](https://ithelp.ithome.com.tw/articles/10225609)

### 前情提要

------------------------------------------------------------------------

昨日看到 `gostartcallfn` 函式眼睛一亮，但終究只是設定一些 context，runtime 還未結束，仍需繼續 trace。

#### 接下去呢？

```go
        if _g_.m.curg != nil {
                newg.labels = _g_.m.curg.labels    
        }        
        if isSystemGoroutine(newg, false) {
                atomic.Xadd(&sched.ngsys, +1)
        }        
        newg.gcscanvalid = false
        casgstatus(newg, _Gdead, _Grunnable)

```
再來首先有一個判斷式，直譯的話是當前的 goroutine 的 thread 的正在執行的 goroutine，實在是不太確定為何會有此差別。使用 gdb 下去追蹤，發現：

```
Breakpoint 1, runtime.newproc1 (fn=0x4cf4b0 <runtime.mainPC>, argp=0x7fffffffded0 "\001", narg=0, callergp=0x558060 <runtime.g0>, 
    callerpc=4518057) at /usr/lib/go/src/runtime/proc.go:3323
3323        if _g_.m.curg != nil {
(gdb) p _g_
$1 = (runtime.g *) 0x558060 <runtime.g0>
(gdb) p _g_.m
$2 = (runtime.m *) 0x5585c0 <runtime.m0>
(gdb) p _g_.m.curg 
$3 = (runtime.g *) 0x0

```
但是這個判斷式本身是什麼意思呢？找來找去，筆者在 `runtime/signal_unix.go` 裡面找到了端倪。這裡有個 `sigfwdgo` 函式，它由 signal handler 呼叫，

```go
        // Determine if the signal occurred inside Go code. We test that:
        //   (1) we weren't in VDSO page,
        //   (2) we were in a goroutine (i.e., m.curg != nil), and
        //   (3) we weren't in CGO.
        g := sigFetchG(c) 
        if g != nil && g.m != nil && g.m.curg != nil && !g.m.incgo {
                return false
        }

```
給了線索的是這裡的註解。它說要測試三種狀況，但是卻有四組判斷式？第一個判斷 g 是否非空之所以能夠扯到 VDSO 機制，是因為對特定 CPU 架構來講，在 VDSO 頁面中執行 `getg` 函式會出問題，所以 `sigFetchG` 函式就會在那些情況下回傳空值給予 g；接下來的 `g.m` 與 `g.m.curg` 就是我們所關心的第二項：這代表該 signal 發生時**正在執行某個 goroutine**。

這是否表示我們現在的狀態不能算是正在執行某個 goroutine？也就是說，`g0` 算是特殊的角色？筆者預期我們在後面的執行當中，應該總會有些關於 m 和 p 的操作，屆時應該可以多得到一些線索才是。

```go
        if _g_.m.curg != nil {
                newg.labels = _g_.m.curg.labels    
        }        

```
從上述的 gdb 內容，我們知道這個判斷是不會進來的。其中的 `labels` 成員，似乎與 profiling 功能有關，這裡先行跳過。接下來是：

```go
        if isSystemGoroutine(newg, false) {
                atomic.Xadd(&sched.ngsys, +1)
        }        

```
`isSystemGoroutine` 的語意很容易理解，它的目的是要檢查 `newg` 所代表的 goroutine 是否會被排除在 stack dump 與 deadlock 偵測機制之外。大致來講，被歸屬在系統 goroutine 的那些 G 的條件就是它們是隸屬於整個執行期環境，也就是 `runtime.` 開頭的。然而，我們現在經歷的就是其中一個例外，`runtime.main` 不在此範圍，所以其實這個判斷也不會進入。

接下來是，

```
        newg.gcscanvalid = false
        casgstatus(newg, _Gdead, _Grunnable)

```
`gcscanvalid` 成員的註解說明，它在**開始一個 gc 巡迴**的時候必須設成 false，在上一次執行 scan 之後都沒有跑過的話要設成 true。這裡 `newg` 才剛創始，所以當然是前者的狀況。再來我們又遇到 `casgstatus` 函式，這次已經將之標記為 runnable 了。

#### ID 設置

```go
        if _p_.goidcache == _p_.goidcacheend {
                // Sched.goidgen is the last allocated id,
                // this batch must be [sched.goidgen+1, sched.goidgen+GoidCacheBatch].
                // At startup sched.goidgen=0, so main goroutine receives goid=1.
                _p_.goidcache = atomic.Xadd64(&sched.goidgen, _GoidCacheBatch)
                _p_.goidcache -= _GoidCacheBatch - 1
                _p_.goidcacheend = _p_.goidcache + _GoidCacheBatch
        }
        newg.goid = int64(_p_.goidcache)
        _p_.goidcache++

```
為什麼不能用一個 `newg.goid = _p_.goidcache++` 之類的算式直接解決呢？筆者猜測這是因為，所有的 goroutine 都必須有一個獨一無二的 ID，而若是流水號機制是全域的設計的話，就無法避免多個 thread (P) 之間的同步處理。所以這裡導入了一個**批次**（batch）機制。既然還是沒辦法避免有個全域的流水號（sched.goidgen），那麼對每個 thread 來說，就一次多要幾個（`_GoidCacheBatch`）流水號回到本地端。

這也就是一開始的判斷式的由來。如果本地端可以發的號碼（`idcache`） 已經到底（`idcacheend`）了，那就只好走一次需要原子操作的全域同步流程；反之，直接將現有的配置給 `newg.goid`。

### 疑問

------------------------------------------------------------------------

- `labels` 成員代表的意義？profiling 的使用方法？
- 為什麼 `runtime.main` 會有特殊的待遇，不被算在系統 goroutine 裡面？

### 本日小結

------------------------------------------------------------------------

看到 `newg` 領到號碼牌了！
