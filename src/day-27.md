# 第二十七天：goroutine 執行中

- Day: 27
- 發佈日期: 2019-10-12
- 原文: [https://ithelp.ithome.com.tw/articles/10227340](https://ithelp.ithome.com.tw/articles/10227340)

### 前情提要

------------------------------------------------------------------------

昨日加前日，將 signal 相關的機制瀏覽完，然後準備進入 `schedule`。

#### 加入排程

終於來到這個[無法折返點](https://www.youtube.com/watch?v=D-ZAgfR_Ck0)了。`schedule` 函式也還是一個 GO 語言函式，位在 `runtime/proc.go` 裡面。由於這個函式會被各個執行緒或 goroutine 頻繁地呼叫，所以裡面有各種場合的所需要的判斷，但這裡且讓我們先直衝 `main`：

```go
func schedule() {   
        _g_ := getg() 
                    
        if _g_.m.locks != 0 {
        ...
                    
        if _g_.m.lockedg != 0 {
        ...
                    
        if _g_.m.incgo {
        ...

    ...

    if gp == nil {                       
                if _g_.m.p.ptr().schedtick%61 == 0 && sched.runqsize > 0 {
                        lock(&sched.lock)    
                        gp = globrunqget(_g_.m.p.ptr(), 1)
                        unlock(&sched.lock)  
                }                            
        }                                    
        if gp == nil {                       
                gp, inheritTime = runqget(_g_.m.p.ptr())
                if gp != nil && _g_.m.spinning {       
                        throw("schedule: spinning with local work")
                }                            
        }                                    
        if gp == nil {                       
                gp, inheritTime = findrunnable() // blocks until work is available
        }

    ...
    execute(gp, inheritTime)
}

```
中間這裡有連續三個針對 `gp` 為空的判斷，其實就是要尋找要拿來排程的 goroutine 的順位。雖然本地端佇列應該是最理想的候選，但是第一段會在相對比較稀有的情況下先從全域佇列取得可以執行的 goroutine；再來就是用 `runqget` 函式取得的、我們之前在 `newproc` 函式中放入的 `newg`；最後的話則是檢查各種可執行工作的來源，比方說全域佇列、其他 P 的工作、或是網路的 poll 工作。讓我們看看 `runqget` 裡面發生了什麼事：

```go
func runqget(_p_ *p) (gp *g, inheritTime bool) {
        // If there's a runnext, it's the next G to run.
        for {                   
                next := _p_.runnext 
                if next == 0 {  
                        break   
                }                
                if _p_.runnext.cas(next, 0) { 
                        return next.ptr(), true
                }               
        }

```
雖然還有後半段自本地端佇列取得閒置的 G 的方式，但是現在我們會在這裡直接回傳擺到 `runnext` 快取區的的那一個 goroutine。在這之後的判斷式也都不會成立，直到最後執行 `execute` 進入。參數中的 `gp` 自然不需要多描述，`inheritTime` 是新生成的 goroutine 是否需要繼承舊有的 time slice 的布林值，這會牽涉到排程器管理它的方法。

#### `execute` 函式（一樣是在 `runtime/proc.go` 裡面）

註解說明：這個函式將 `gp` 排程到現在的 M 上面執行。`inheritTime` 如前段所述。這個函式不會回到 caller 那裡去，是一個比較特殊的函式。此外還有前幾日留作疑問的 write buffer 相關問題，這裡說可以允許 write buffer，因為在許多地方呼叫這個函式的時候都剛剛取得 P 而已。

```go
func execute(gp *g, inheritTime bool) {
        _g_ := getg()
                 
        casgstatus(gp, _Grunnable, _Grunning)
        gp.waitsince = 0
        gp.preempt = false
        gp.stackguard0 = gp.stack.lo + _StackGuard
        if !inheritTime {
                _g_.m.p.ptr().schedtick++
        }        
        _g_.m.curg = gp
        gp.m = _g_.m

    ...
    gogo(&gp.sched)

```
這裡再度有一次透過 `casqstatus` 的狀態更迭，從**可執行**變為**執行中**。`waitsince` 是一個與 block 狀態相關的估計值，這裡是初始化。`preempt` 成員代表是否能夠被訊號搶佔。`stackguard0` 成員的設置方式則與之前設置 stack 的時候相同。然後，將當前的 M（仍然是 `m0`）的當前 goroutine 設定成 `gp`，並讓 `gp` 的執行緒為當前的 `_g_` 的。

最後這個 `gogo` 使用的參數 `gp.sched`，就是前幾天在 `newporc1` 函式的時候已經設好的。它本身類似 C 語言中 `longjmp` 的呼叫。當時已經存下的 `pc`，正是 `runtime.main`。所以這裡可以合理期待，應該會進入一些系統相依的組語片段，然後就跳轉到 `runtime.main` 裡面去吧。

果不其然，存取完 `gobuf` 型別的 `gp.sched` 之後，`gogo` 函式會陸續設置堆疊、goroutine（比方說，處理 TLS 使得之後的 `getg` 函式可以取得這個新的 goroutine）、以及 GC 需要的資訊，然後最後一步當然就是跳到 `runtime.main` 去

#### `runtime` 的 `main` 函式！

```go
func main() {
        g := getg()
        g.m.g0.racectx = 0

        if sys.PtrSize == 8 {
                maxstacksize = 1000000000
        } else {
                maxstacksize = 250000000
        }    
         
        // Allow newproc to start new Ms.
        mainStarted = true
         
    ...

```
> 重複提醒一次，這時候透過 `getg` 函式取得的 `g` 已經不是 `g0` 了。

一開始存取 `g0` 的 `racectx` 成員變數，應該是某些只有 `race` 編譯選項打開的時候才會用到的東西，這裡也就跳過去。`sys.PtrSize` 是否為 8 的判斷是為了依照 32 或 64 位元系統的差異分別設置最大的堆疊大小。接下來是全域變數 `mainStarted` 的設置；單就字面上的意義來講是沒什麼問題，但是註解很耐人尋味，它設置為真的結果是能夠允許 `newproc` 啟動新的 M？有個線索在第二十三天的內容裡面，當時我們在 `newproc1` 函式的後段，有個相關的複合判斷式，

```go
        if atomic.Load(&sched.npidle) != 0 && atomic.Load(&sched.nmspinning) == 0 && mainStarted {
                wakep()
        }

```
這個註解的**啟動新的 M** 的意思應該是，這個 `wakep` 函式呼叫之後，有可能在**找不到閒置的 M** 的情況下呼叫 `newm` 函式。事實上，根據 gdb 執行的狀態來看，很有可能為了 hello world 這樣的程式也產生出 4 個執行緒的過程也會包含上述路徑吧。

### 疑問

------------------------------------------------------------------------

- 之前也曾經為此混亂過，總覺得有時候註解的文意裡面不會太區分 M、P 的概念。之後應該了解一下 `wakep` 函式與 `newm` 函式。

### 本日小結

------------------------------------------------------------------------

今日從 `schedule` 函式出發，進入到看就知道同樣很重要的 `execute` 函式，並且狀態變成了執行中。
