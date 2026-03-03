# 第二十九天：終點的 main.main

- Day: 29
- 發佈日期: 2019-10-14
- 原文: [https://ithelp.ithome.com.tw/articles/10227829](https://ithelp.ithome.com.tw/articles/10227829)

### 前情提要

------------------------------------------------------------------------

昨日一路單槍匹馬的執行流程 fork 出了一個 `sysmon` 執行緒在另外一個 M 上，正式成為多線程並行程式了。

#### 多線程除錯的現實

我們現在有兩隻執行緒，其中一隻是原本的主執行緒，它執行完 `clone` 系統呼叫之後，因為都已經在各個呼叫的尾部，所以很快就沿著原路順序回到 `newosproc`、`newm1`、`newm`、`runtime.main` 去繼續執行期的設置工作；另一邊廂，新生的執行緒轉入 `sysmon` 函式之後，會做些什麼、走到哪裡呢？

筆者對於 gdb 的運行原理其實不太熟悉，因此不能肯定我們一路以來對 GO 程式除錯的經驗是常態或是異常；但無論如何，筆者觀察到一個現象是，當我在除錯 prompt 中鎖定一個 thread 作 `step`（含進入函式呼叫的下一步指令） 或 `next`（不含進入函式呼叫的下一步指令）的時候，其餘的執行緒都會前進的非常快速，以致於我們必須**反向操作**。也就是說，如果我想看主執行緒，我可以卡在系統監控者做幾次步進之後再觀察；但由於被卡住的執行緒以外的執行緒都會執行的非常快速，所以其實常常這樣操作幾次之後，主執行緒就已經走完 `main.main` 並結束了。

也就是說，我們這裡必須要很迂迴的去追了？也未必盡然，筆者發現 stackoverflow 上有[這篇文章](https://stackoverflow.com/questions/2643884/how-to-continue-one-thread-at-a-time-when-debugging-a-multithreaded-program-in-g)關於特定執行緒的恢復政策問題，似乎可以解決上述問題？這就來試試看：

```
(gdb) set scheduler-locking on
Target 'exec' cannot support this command.
(gdb) b runtime.sysmon
Breakpoint 1 at 0x434d10: file /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go, line 4315.
(gdb) run
Starting program: /home/noner/FOSS/2019ITMAN/go/src/hw 
[New LWP 4598]
[New LWP 4599]
[New LWP 4600]
[New LWP 4601]
[Switching to LWP 4598]

Thread 2 "hw" hit Breakpoint 1, runtime.sysmon () at /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:4315
4315    func sysmon() {
(gdb) set scheduler-locking on
(gdb) info threads
  Id   Target Id         Frame 
  1    LWP 4594 "hw"     runtime.clone () at /home/noner/FOSS/2019ITMAN/go/src/runtime/sys_linux_amd64.s:556
* 2    LWP 4598 "hw"     runtime.sysmon () at /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:4315
  3    LWP 4599 "hw"     runtime.clone () at /home/noner/FOSS/2019ITMAN/go/src/runtime/sys_linux_amd64.s:556
  4    LWP 4600 "hw"     runtime.clone () at /home/noner/FOSS/2019ITMAN/go/src/runtime/sys_linux_amd64.s:556
  5    LWP 4601 "hw"     runtime.clone () at /home/noner/FOSS/2019ITMAN/go/src/runtime/sys_linux_amd64.s:556

```
各位讀者可以看到，這次的執行在卡在系統監控者所在之斷點之前，主執行緒那邊已經多 clone 出三個執行緒在等了。參考上述連結，使用 `set scheduler-locking on` 的排程鎖定功能，的確是可以如預期般運作的。

> `scheduler-locking` 本身還有其他功能，可參考它本身的 help 訊息去使用。

系統監控者函式內有一個巨大的迴圈且沒有離開條件。大略來說它做的事情就是 delay 一段時間，然後觀察是否要幫整個系統打雜，檢查 GC 狀態或是處理網路相關內容之類的操作。

#### 主執行緒接下來的路

既然如此，我們就可以不在被其他 thread 干擾的情況繼續看看主執行緒的行為了。

```go
        lockOSThread()
         
        doInit(&runtime_inittask) // must be before defer
         
        // Defer unlock so that runtime.Goexit during init does the unlock too.
        needUnlock := true
        defer func() {
                if needUnlock {
                        unlockOSThread()
                }
        }()

        gcenable()
                
        main_init_done = make(chan bool)
                    
        doInit(&main_inittask)
                
        close(main_init_done)
        needUnlock = false
        unlockOSThread()

    fn := main_main // make an indirect call, as the linker doesn't know the address of the main package when laying down the runtime
        fn()

```
成對的內容可以先拆解分析。比方說 `lockOSThread` 和 `unlockOSThread`。**鎖定**是為了在初始化階段將主要 goroutine 綁定主要系統執行緒。綁定的方法也很簡單（反之亦然），它的內容是：

```go
func lockOSThread() {
        getg().m.lockedInt++
        dolockOSThread()                                                                                                          
}
...
func dolockOSThread() {
        if GOARCH == "wasm" {
                return // no threads on wasm yet
        }
        _g_ := getg()
        _g_.m.lockedg.set(_g_)
        _g_.lockedm.set(_g_.m)
}

```
值得一提的是解除綁定的呼叫出現過兩次，一次是真正的比較靠近尾端的時候，但第一次是使用 `defer` 呼叫的，根據註解，這可以讓它在 `runtime.Goexit` 執行時被呼叫。但是若是設置斷點於 `unlockOSThread`，會發現 Hello World 程式不會走到兩者任一。

`main_init_done` 是一個攜帶布林值的 channel，它也是與 C 的交接界面 cgo 機制的一部分，這裡就略過了。

#### `doInit` 是在 do 什麼 init？

上面一段引用的程式碼片段中出現了兩個 `doInit` 函式呼叫。一個使用參數 `runtime_inittask`，另一個則是 `main_inittask`。第一個的註解顯示它必須在 `defer` 使用之前呼叫。這兩個參數都屬於 `initTask` 型別，

```go
type initTask struct { 
        // TODO: pack the first 3 fields more tightly?
        state uintptr // 0 = uninitialized, 1 = in progress, 2 = done
        ndeps uintptr
        nfns  uintptr
        // followed by ndeps instances of an *initTask, one per package depended on
        // followed by nfns pcs, one per init function to run
}

```
這個裡面就是放置一些初始化軟體包（package）需要的內容了。`state` 表示整個軟體包初始化階段，我們稍後進入 `doInit` 時會看到；`ndeps` 是則是其他相依的軟體包數量，至於實體則會接在 `nfns` 之後；`nfns` 成員是初始化所需要的函式數量，那些函式也會被附帶在後面。所以雖然看起來這個結構體的固定成員只有三個 `uniptr`，但實際上是一個不定長度結構。

處理這個結構的 `doInit` 方法如下：

```go
func doInit(t *initTask) {                                  
        switch t.state {                                    
        case 2: // fully initialized                        
                return                                      
        case 1: // initialization in progress               
                throw("recursive call during initialization - linker skew")
        default: // not initialized yet                     
                t.state = 1 // initialization in progress   
                for i := uintptr(0); i < t.ndeps; i++ {     
                        p := add(unsafe.Pointer(t), (3+i)*sys.PtrSize)
                        t2 := *(**initTask)(p)              
                        doInit(t2)                          
                }                                           
                for i := uintptr(0); i < t.nfns; i++ {      
                        p := add(unsafe.Pointer(t), (3+t.ndeps+i)*sys.PtrSize)
                        f := *(*func())(unsafe.Pointer(&p))
                        f()                                 
                }                                           
                t.state = 2 // initialization done          
        }                                                   
}

`state` 在這裡標誌著初始化的進度，完全的新軟體包為 0，還在初始化當中為 1，已經完成相依性和初始化函式執行則是完整的 2。整個 switch 結構之中還是預留了代表初始化當中的狀態的 1 的狀況，因為這時候可能表示 linker 出了點差錯。除此之外，本體還是在整個 default 的狀況裡面。

有兩個 for 迴圈分別擔任**相依性解析**與**初始函式呼叫**的工作。對於 C 母語的筆者來說，不定長度結構體的拆解沒有什麼神秘，就是指標的計算與挪移而已，這裡其實也需要一模一樣的手續，所以使用 `add` 通用函式與 `unsafe.Pointer` 操作指標。至於取得相關位置之後的後續處置，第一個負責相依性解析的迴圈是遞迴呼叫 `doInit` 本身，這其實也相當直觀；初始函式的呼叫也相當如此，就是當作間接的函式呼叫。

這個追蹤的過程也相當有趣。一開始的 `runtime` 初始有一個相依套件 `internal/bytealg`；後來的 `main` 初始就走得比較深了，雖然他本身只有 `fmt` 一個，但是後續還會因此使用到 `error`、`strconv`、`error`、`internal/reflectlite` 等等。


這些都走完了之後，我們終於進入到了最初的起點，`main.main`。

### 疑問
---
* 之前也問過了，可是為什麼函式指標要傳程式碼的指標的指標？
* 什麼叫做主要 goroutine？主要 OS thread？難道不是 `runtime.g0` 和 `runtime.m0` 嗎？
* `defer` 和 `go` 都是很常用的非同步關鍵字。它們生效的機制是什麼？（使用 gdb 已知 `go` 可能會觸發 `runtime.newproc`）
* 為什麼 `main.main` 會沒辦法被 linker 定位？還是說 GO 的連結方式有順序性，所以才強調 **when laying down the runtime**？

### 本日小結
---
介紹一個並行除錯技巧並觀察 `runtime.main` 的部份內容，並且終於來到 `main.main` 與之銜接。
```
