# 第二十天：新生 goroutine 的初始狀態

- Day: 20
- 發佈日期: 2019-10-05
- 原文: [https://ithelp.ithome.com.tw/articles/10224869](https://ithelp.ithome.com.tw/articles/10224869)

### 前情提要

------------------------------------------------------------------------

昨日我們走過 `newproc1` 函式的最開頭部份；順利的情況下，能夠取得一個新的 G。

#### 使用 gdb 驗證

我們將斷點設在 `runtime.newproc1` 開始之後，觀察 `gfget` 函式裡走過的路徑。經過幾次 n 之後，

```
runtime.gfget (_p_=0xc00002c000, ~r1=<optimized out>) at /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:3476
3476    func gfget(_p_ *p) *g {
...
(gdb) n
3478        if _p_.gFree.empty() && (!sched.gFree.stack.empty() || !sched.gFree.noStack.empty()) {

```
這裡的三個複合條件式如何被展開呢？反組譯一下當前的 pc：

```
(gdb) x/10i $pc
=> 0x432fb3 <runtime.gfget+163>:   mov    0xde8(%rax),%rcx
   0x432fba <runtime.gfget+170>:  test   %rcx,%rcx
   0x432fbd <runtime.gfget+173>:  jne    0x432fed <runtime.gfget+221>
   0x432fbf <runtime.gfget+175>:  cmpq   $0x0,0x123a51(%rip)        # 0x556a18 <runtime.sched+152>
   0x432fc7 <runtime.gfget+183>:  jne    0x432fd3 <runtime.gfget+195>
   0x432fc9 <runtime.gfget+185>:  cmpq   $0x0,0x123a4f(%rip)        # 0x556a20 <runtime.sched+160>
   0x432fd1 <runtime.gfget+193>:  je     0x432fed <runtime.gfget+221>
   0x432fd3 <runtime.gfget+195>:  lea    0x123a36(%rip),%rax        # 0x556a10 <runtime.sched+144>
   0x432fda <runtime.gfget+202>:  mov    %rax,(%rsp)
   0x432fde <runtime.gfget+206>:  callq  0x4095b0 <runtime.lock>

```
一個 `test` 指令與兩個 `cmpq`，應該就是這裡的三個條件式了。其中，後面的兩個 `cmpq` 比較對象接近，應該就是同屬於全域佇列的 `sched.gFree` 結構化約而來的；另外一個線索則是稍後位於 `0x432fde` 的 `runtime.lock` 呼叫，它所欲取得的參數是 `&sched.gFree.lock`，所以這個判斷應該沒有錯了。接下來使用 `si` 指令，看看能走到哪裡...

```
...
(gdb) 
3497        gp := _p_.gFree.pop()

```
結果一路走過三個判斷式之後，跳到了整個 `if` 結構體之外。語意上，這表示我們經過的判斷是**本地端佇列為空**並且**兩種全域佇列均為空**。所以接下來的 `pop` 方法也註定會拿不到東西，而回傳 `nil` 離開。

這是否也相當合理呢？從架構相依的部份切入至今，也沒有看到 GO 語言有特別作些什麼操作，讓本地端、全域端有閒置的 G 可以使用。所以以這裡 `gfget` 的語意來講，拿不到任何閒置的 G 應該是情理之常的。

#### 另外一種情況：`gfget` 沒有回傳一個可用的 `newg`

也就是說，我們這裡會面對的是接下來的這一段了。

```go
        if newg == nil {
                newg = malg(_StackMin)
                casgstatus(newg, _Gidle, _Gdead)
                allgadd(newg) // publishes with a g->status of Gdead so GC scanner doesn't look at uninitialized stack.
        }

```
透過 `malg` 函式（同在 `runtime/proc.go` 之中），配置一個新 G。

> 值得注意的是，`malg` 在這裡並不是第一次被呼叫喔！第一次是我們一週前追蹤很久的 `schedinit`、`mcommoninit`、`mpreinit` 呼叫順序，然後呼叫到 `malg` 取得這個最早的 G。

`malg` 的內容如下：

```go
func malg(stacksize int32) *g {      
        newg := new(g)               
        if stacksize >= 0 {          
                stacksize = round2(_StackSystem + stacksize)
                systemstack(func() { 
                        newg.stack = stackalloc(uint32(stacksize))
                })                   
                newg.stackguard0 = newg.stack.lo + _StackGuard
                newg.stackguard1 = ^uintptr(0)
        }                            
        return newg                  
}

```
透過 `new` 關鍵字，配置一塊 g 物件所需的記憶體空間之後，有一個根據 `stacksize` 是否非負的判別。我們傳進來的路徑是使用 `_StackMin` 常數（定義在 `runtime/stack.go`），其值為 2048，是 GO 語言均一的最小堆疊量。`_StackSystem` 是一個作業系統相依的修正值，Linux 不會使用到因此為 0。`round2` 函式負責以傳入的數值為基準，回傳一個大於它的最小 2 冪次方數。

`stackalloc` 函式根據指定的堆疊量配置記憶體，其中有許多條件判斷分別針對不同的需求（大小、來源等等）。這裡可以看到 GO 語言執行期環境在這裡使用 `systemstack`，因此不會進入**非**系統堆疊的配置路線；剩下的系統堆疊路徑上，又依其大小有不同的處理。我們剛才才看到這裡傳入的是 2048，所以走的就是小量堆疊的生成的路線。程式碼片段如下：

```go
                c := thisg.m.mcache
                if stackNoCache != 0 || c == nil || thisg.m.preemptoff != "" {
...
                } else {
                        x = c.stackcache[order].list
                        if x.ptr() == nil {
                                stackcacherefill(c, order)
                                x = c.stackcache[order].list
                        }
                        c.stackcache[order].list = x.ptr().next
                        c.stackcache[order].size -= uintptr(n)
                }
                v = unsafe.Pointer(x)
...
    return stack{uintptr(v), uintptr(v) + uintptr(n)}

```
`if` 的部份並未進入。`mcache` 依照註解，是每個 P 所獨有的空間，專門給小型的記憶體使用。`order` 變數在稍早，由傳入的堆疊量的對數值計算出來。顯然這裡的 `stackcache` 能夠分別提取不同大小的小物件。賦 `list` 值給 `next`、將當前的 `size` 量減少、最後回傳 `v` （對應到 `stack` 物件的 `lo` 成員）開始 `n` 的一塊空間。

取得這個新的堆疊之後，也會設定兩個 `stackGuard` 成員，這裡就先跳過了。

#### 狀態切換

```go
        if newg == nil {
                newg = malg(_StackMin)
                casgstatus(newg, _Gidle, _Gdead)
                allgadd(newg) // publishes with a g->status of Gdead so GC scanner doesn't look at uninitialized stack.
        }

```
再來就是 `casgstatus` 函式了。後兩個傳入參數很明顯是 G 的狀態，它們被定義在 `runtime/runtime2.go` 裡面。`_Gidle` 的值為 0，就是現在這個剛生成的狀態；後者的 `_Gdead` 就稍微複雜一點，它可能表示這個 G 剛離開、存在於閒置佇列、或是剛被初始化，總之是並非正在執行使用者程式碼的狀態，它可能已經配置好堆疊了，也可能還沒有。開頭的 `cas` 代表**比較並同時交換**（Compare And Swap），通常會使用 CPU 的原子指令（atomic instruction）支援。無論如何，這裡就是將新的 G 轉換到 `_Gdead` 的狀態。

> 有趣的是，有一個特殊的 goroutine 狀態是 `_Gscan`，它可以與 `runnable`、`running`、`syscall`、`waiting` 的狀態標記搭配。顧名思義，這個輔助標記與 GC 有關。正如接下來要看的 `allgadd` 函式後註解一樣，將這個新的 G 的狀態設成 `_Gdead` 而不帶 `_Gscan`，就可以避免 GC 的機制觸及這個新配置的記憶體部份。

`allgadd` 函式相當簡單，先是作簡單的錯誤排除（不該在這時候看見狀態為 `_Gidle` 的 goroutine），再來是在 `allglock` 的保護區域之內執行 `append` 這個內建方法。

### 疑問

------------------------------------------------------------------------

- `malg` 使用 `new` 關鍵字配置所需的記憶體，相關機制為何？所取得的的記憶體應該會在 heap 上。
- 關於 `mcache`，為何註解說是 per-P 結構，這裡卻是由 M 來提取呢？
- 兩個 `stackGuard` 分別有什麼用呢？註解中是有解釋，但是還是有點抽象。

### 本日小結

------------------------------------------------------------------------

取得可以用的 G 了！接下來這個 goroutine 要如何開始乘載使用者程式呢？
