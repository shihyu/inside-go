# 第二十三天：開始排隊

- Day: 23
- 發佈日期: 2019-10-08
- 原文: [https://ithelp.ithome.com.tw/articles/10225785](https://ithelp.ithome.com.tw/articles/10225785)

### 前情提要

------------------------------------------------------------------------

之前取得的 `newg` 狀態已經調整為可執行，而且也已經分配好 ID 了。

#### `newproc1` 的尾巴

```go
        if raceenabled {
                newg.racectx = racegostart(callerpc)
        }         
        if trace.enabled {
                traceGoCreate(newg, newg.startpc)
        }         
        runqput(_p_, newg, true)
                  
        if atomic.Load(&sched.npidle) != 0 && atomic.Load(&sched.nmspinning) == 0 && mainStarted {
                wakep()
        }         
        releasem(_g_.m)

```
`raceenabled` 之前也看過，但是這裡似乎連編譯都沒有編進去；如果要使用這個功能的話，根據 `runtime/race0.go` 的註解說是必須要使用 `-race` 編譯選項。`trace.enabled` 的判斷也沒有進入，看來 trace 功能也是要另外打開的，可以參考[這篇文件：Go Execution Tracer](https://docs.google.com/document/u/1/d/1FP5apqzBgr7ahCCgFO-yoVhk4YZrNIDNf9RybngBc14/pub)。

所以接下來的 `runqpunt` 顯然是一大重點！傳入了稍早透過 `_p_ := _g_.m.p.ptr()` 取得的 P，還有新生成的 `newg` 還有一個布林值，我們來看看裡面是怎麼回事。

#### `runqput`

（註解說）`runqput` 會試著把 G 放到本地端的可執行佇列（local runnable queue）去。根據傳入的布林值（參數名為 `next`）真偽，有不同的處理方式：

- `next` 為否時，將傳入的 G 放到可執行佇列尾端。
- 為真時，將這個 G 放到 `_p_.runnext` 當中。我們可以在 `runtime/runtime2.go` 裡面找到這個成員變數的功能說明，算是增進排程效率的一種方法，比方說如果當前的 G 執行到等待階段而它的 `P.runnext` 裡面有個可以執行的 G，那就可以省掉一部分排程器延遲。這裡 `newproc1` 的用法屬於為真的這一項。
- 布林值不就為真或為否嗎？是沒錯，但如果可執行佇列已滿，這個操作也會沒辦法順利執行。所以只好將這個 G 放到全域執行佇列去了。

註解也說明，這個函式只能被 P 的擁有者呼叫，應該就是說不能幫其它的 P 呼叫的意思吧？回顧一下也可以驗證發現，在 `newproc1` 的開頭與結束分別有 `acquirem` 和 `releasem` 函式，執行到這裡為止應該算是正牌的擁有者吧。`runqput` 的內容如下：

```go
func runqput(_p_ *p, gp *g, next bool) {
        if randomizeScheduler && next && fastrand()%2 == 0 {
                next = false
        }
                                                                                                                               
        if next {
        retryNext:
                oldnext := _p_.runnext
                if !_p_.runnext.cas(oldnext, guintptr(unsafe.Pointer(gp))) {
                        goto retryNext
                }
                if oldnext == 0 {
                        return
                }
                // Kick the old runnext out to the regular run queue.
                gp = oldnext.ptr()
        }

```
一進入的判斷式在處理一個與之前也看過的 race 相關功能有關。由於 goroutine 的設計特性，使得 GO 語言在設計階段就謹慎考慮了並行多執行緒的執行狀況，`raceenabled` 所代表的 race 功能，就是要讓編譯出來的 GO binary 更能夠撞到 race condition，突顯並行的邏輯錯誤。而事實上這裡的第一個條件 `randomizeScheduler` 就是直接等於 `raceenabled` 的一個值。

由於傳入的 `next` 為真，接下來就會進入 `retryNext` 標籤以下的部份。`cas` 成員函式將舊值與轉型為 `guintptr` 的 `gp` 換到原本 `_p_.runnext` 的位置。透過 gdb 驗證的結果，我們在這個階段就成功的交換，並且發現接下來的判斷式中的 `oldnext` 為零而回傳了。這也是合理的，畢竟才正要開執行工作的 P 沒有道理已經擁有方便排程的快取 goroutine。

後面的流程呼應之前註解的說明，還是簡單帶過。如果是之後的執行狀況，很可能 `oldnext` 真的有值，那麼原本的這個 G 就應該被加到佇列去，也就是說可以和傳入的 `next` 為否的情況的流程共用。

```go
retry: 
        h := atomic.LoadAcq(&_p_.runqhead) // load-acquire, synchronize with consumers
        t := _p_.runqtail
        if t-h < uint32(len(_p_.runq)) {
                _p_.runq[t%uint32(len(_p_.runq))].set(gp)
                atomic.StoreRel(&_p_.runqtail, t+1) // store-release, makes the item available for consumption
                return
        }
        if runqputslow(_p_, gp, h, t) {
                return
        }
        // the queue is not full, now the put above must succeed
        goto retry

```
接下來先取得代表執行佇列頭的 `h` 與 `t`，並可以據以判斷本地端執行佇列是否還有空間，若有就是進到第一個判斷區塊中，可見 `runq` 的陣列元素有個 `set` 成員函式可以將 `gp` 加入。最後一種情況就是非得將 G 加入全域執行佇列，使用 `runqputslow`。

#### 回到 `newproc1`

```go
        if atomic.Load(&sched.npidle) != 0 && atomic.Load(&sched.nmspinning) == 0 && mainStarted {
                wakep()
        }         

```
執行到這裡，用 gdb 觀察這些判斷式分別是怎麼樣的結果：

```
(gdb) x/20i $pc
=> 0x4313b8 <runtime.newproc1+648>:    mov    0x126b92(%rip),%eax        # 0x557f50 <runtime.sched+80>
   0x4313be <runtime.newproc1+654>:   test   %eax,%eax
   0x4313c0 <runtime.newproc1+656>:   je     0x43143f <runtime.newproc1+783>
   0x4313c2 <runtime.newproc1+658>:   mov    0x126b8c(%rip),%ecx        # 0x557f54 <runtime.sched+84>
   0x4313c8 <runtime.newproc1+664>:   test   %ecx,%ecx
   0x4313ca <runtime.newproc1+666>:   sete   %cl
   0x4313cd <runtime.newproc1+669>:   test   %cl,%cl
   0x4313cf <runtime.newproc1+671>:   je     0x4313f4 <runtime.newproc1+708>
   0x4313d1 <runtime.newproc1+673>:   cmpb   $0x0,0x141b42(%rip)        # 0x572f1a <runtime.mainStarted>
   0x4313d8 <runtime.newproc1+680>:   je     0x4313f4 <runtime.newproc1+708>
...

```
這個片段中有三個 `je` 指令都跳到同一個地方，也就是短路的條件。最後一個最容易理解，因為 gdb 都已經逆向解析出該位址的對應標籤是 `runtime.mainStarted`，從理論上推導，我們目前為止還沒有任何 main 開始過的跡象，直接看這個位址也可以發現是零，所以無論如何是不會進入到判斷式區塊內部去執行 `wakep` 函式了。

但是前兩個呢？gdb 沒有為我們解析它們的標籤，但是搜尋一下 `npidle` 與 `nmspinning` 成員可以發現它們都是 `uint32` 型別且彼此相鄰（C 裡面很可能編譯器會根據情況去調整那些位置，但不知道 GO 會不會？），大致上可以當作一個佐證。位置 `0x557f50` 也就是推測是 `sched.npidle` 的值在這時候是 7，算合理因為筆者的實驗平台是 8 核心的機器，而這時候顯然已經有一個 P 正在運作了。位置 `0x557f54` 的內容是零，與 GC 有關，這裡就先跳過了。

最後`releasem` 函式結束，一路返回囉！

### 疑問

------------------------------------------------------------------------

- tracer 的使用方法？
- GO 與 gdb 的聯動還算可用，也是 binutils 處理的轉換嗎？

### 本日小結

------------------------------------------------------------------------

今日將 `newg` 推入到 P 的下一個執行的位置。雖然中途有很多步驟，但都因為我們追蹤的是第一個普通的 G 而省略掉其中大部份。
