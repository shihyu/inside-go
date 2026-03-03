# 第十九天：G 的取得路徑

- Day: 19
- 發佈日期: 2019-10-04
- 原文: [https://ithelp.ithome.com.tw/articles/10224649](https://ithelp.ithome.com.tw/articles/10224649)

### 前情提要

------------------------------------------------------------------------

昨日我們都在爬梳註解與其他資料，企圖從比較鳥瞰的角度去觀察排程器與 GO 的系統模型。

#### `acquirem` 和 `releasem`（在 `runtime/runtime1.go`）

由於越想越在意，還是將前天最後的問題拿出來檢討一番：

```go
//go:nosplit
func acquirem() *m {                                                                                                                    
        _g_ := getg()
        _g_.m.locks++
        return _g_.m
}     
      
//go:nosplit
func releasem(mp *m) {
        _g_ := getg()
        mp.locks--
        if mp.locks == 0 && _g_.preempt {
                // restore the preemption request in case we've cleared it in newstack
                _g_.stackguard0 = stackPreempt
        }
}

```
如擷取片段所示，這兩個函式的命名分明相當具有 atomic 感覺，但是其中實作不是那麼回事。這個 `locks` 成員變數也只是普通的 `int32`。但是如果我們回想昨天啃註解啃的那麼辛苦，就可以合理猜想，也許是因為 M (worker thread) 不會同時在加或同時在減的緣故吧。姑且就當作這麼回事好了。

#### 繼續 `newproc1`

前面略過一段與檢查參數大小相關的部份，接著：

```go
        _p_ := _g_.m.p.ptr()
        newg := gfget(_p_)                                                                                                         

        if newg == nil {
                newg = malg(_StackMin)
                casgstatus(newg, _Gidle, _Gdead)
                allgadd(newg) // publishes with a g->status of Gdead so GC scanner doesn't look at uninitialized stack.
        }

```
先取得由當前的 `_g_` 所屬的 M（thread）的 P（context），然後呼叫 `gfget` 函式取得新的 G。這個新的 G 是什麼東西呢？簡單來說就是從一群閒置的 G 裡面取得的其中一個，為此我們可以觀察 `gfget` 函式（同樣在 `runtime/proc.go` 之中）的內部，相當難得的，非常容易讀懂：

```go
func gfget(_p_ *p) *g {     
retry:                      
        if _p_.gFree.empty() && (!sched.gFree.stack.empty() || !sched.gFree.noStack.empty()) {
                lock(&sched.gFree.lock)
                // Move a batch of free Gs to the P.
                for _p_.gFree.n < 32 {
                        // Prefer Gs with stacks.
                        gp := sched.gFree.stack.pop()
                        if gp == nil {
                                gp = sched.gFree.noStack.pop()
                                if gp == nil {
                                        break
                                }
                        }   
                        sched.gFree.n--
                        _p_.gFree.push(gp)
                        _p_.gFree.n++
                }           
                unlock(&sched.gFree.lock)  
                goto retry  
        }

```
也是難得看到一個 C-like 的標籤用法！乍看之下，這個 `retry` 無論如何是無法避免的，因為只要進入了第一個很長的 `if` 判斷，之後就必然會走到 `goto retry` 敘述而重來。也就是說，其實這個反覆重新嘗試的迴圈的中止條件，就是別進入第一個 `if`。為了翻譯順暢，這裡稍微更動一下順序：

- `!sched.gFree.stack.empty()`：如果 `sched.gFree`（全域閒置佇列）的 `stack`（具有 stack 的 G 清單）不為空的話、或者
- `!sched.gFree.noStack.empty()`：如果 `sched.gFree` 的 `noStack`（沒有 stack 的 G 清單）不為空的話  
  加總起來，就是全域閒置佇列有東西的意思；
- `_p_.gFree.empty()`：如果這個 P 的本地佇列為空  
  再統整起來的話就可以理解，這裡是先處理本地為空、全域有閒置 G 的狀況。而且這裡依照具備 stack 與否來區分閒置的 G，以下會看到他們的不同處理方式。

這一段程式碼還另外有全域的鎖保護整個佇列。如果有得搬的話，這個 P 會不論 stack 有無，總之設法搬到 32 個為止。就算無法搬到 32 個，也許先進入了把全域佇列搬空（且其他 P 也未挹注閒置的 G 到全域佇列）的條件之中並 `break` 離開 for 迴圈，這樣在解鎖、`retry` 之後也一定能夠通過 `if` 判斷式，因為這時候本地端佇列一定有 G。另外，考察 `push`、`pop` 等資料結構方法的話，不難發現它們是定義給 `gList` 這種結構使用的，這裡就不深入。

> 「`retry` 之後本地端佇列一定有 G」這句話是不是怪怪的呢？是的，邏輯上來講，有可能全域佇列一開始有東西，但是進去之後才發現被拿光了，這時候就會 break 出來並從 `retry` 再開始。要是這個狀況一直出現，的確有可能會一直在 `retry` 標籤反覆。但是實際上如何，筆者也不能很確定；應該還是會有防止 starvation 的機制？

又，相對於這一段從全域到本地的過程，另外也有一個呼叫 `gfpurge`，做的是完全相反的事：

```go
func gfpurge(_p_ *p) {                     
        lock(&sched.gFree.lock)            
        for !_p_.gFree.empty() {           
                gp := _p_.gFree.pop()      
                _p_.gFree.n--              
                if gp.stack.lo == 0 {      
                        sched.gFree.noStack.push(gp)
                } else {                   
                        sched.gFree.stack.push(gp)    
                }                          
                sched.gFree.n++            
        }                                  
        unlock(&sched.gFree.lock)          
}

```
這些關於 gList 的資料結構方法可說是簡單明瞭，這裡我們看到一個迴圈重複執行直到這個 P 的本地佇列為空為止，裡面並且有一個分歧條件 `if gp.stack.lo == 0` 用以作為有無 stack 的依據，分別推進不同的 gList 中。這個 `lo` 成員變數又是什麼呢？它被定義在 `runtime/runtime2.go` 之中，

```go
type stack struct {
        lo uintptr  
        hi uintptr
}

```
這其實就是 GO 語言在執行期使用的 stack 的型別，它的空間範圍是從 `lo` 到 `hi`。`lo` 為零的狀況亦即這個變數體本身還沒有被賦值，因此可以說它是沒有 stack 的。

無論如何，確認本地端有內容之後，就會取得一個 G 並使用。

```go
        gp := _p_.gFree.pop()         
        if gp == nil {                
                return nil            
        }                             
        _p_.gFree.n--

```
然後，如果它是來自 `noStack` 部份，就必須幫它初始化；反之的情況下，判斷兩種不同的 flag 來決定是否要額外配置特殊的記憶體。

```go
        if gp.stack.lo == 0 {         
                // Stack was deallocated in gfput. Allocate a new one.
                systemstack(func() {  
                        gp.stack = stackalloc(_FixedStack)
                })                    
                gp.stackguard0 = gp.stack.lo + _StackGuard
        } else {                      
                if raceenabled {      
                        racemalloc(unsafe.Pointer(gp.stack.lo), gp.stack.hi-gp.stack.lo)
                }                     
                if msanenabled {      
                        msanmalloc(unsafe.Pointer(gp.stack.lo), gp.stack.hi-gp.stack.lo)
                }                     
        }                             
        return gp

```
#### 再回到 `newproc1`

從 `gfget` 離開之後，

```go
        newg := gfget(_p_) 
        if newg == nil {
                newg = malg(_StackMin)
                casgstatus(newg, _Gidle, _Gdead)
                allgadd(newg) // publishes with a g->status of Gdead so GC scanner doesn't look at uninitialized stack.
        }        
        if newg.stack.hi == 0 {
                throw("newproc1: newg missing stack")
        }        
                 
        if readgstatus(newg) != _Gdead {
                throw("newproc1: new g is not Gdead")
        }

```
在本地與全域佇列都沒有 G 的情況下，出來之後會使用 `malg` 函式生成一個新的以供使用。

### 疑問

------------------------------------------------------------------------

- `gfget` 到底有沒有可能挨餓？
- 在 `gfget` 之中，從 gFree.stack 拿到 G 的情況下，那兩種不同的 flag 是什麼？什麼時候可以使用相關功能？

### 本日小結

------------------------------------------------------------------------

閒置的 G 如何在全域與本地之間被處理，經過目前為止的這些追蹤，算是比較有點頭緒了。明天我們再繼續看下去吧！
