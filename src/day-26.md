# 第二十六天：signal 初始化收尾

- Day: 26
- 發佈日期: 2019-10-11
- 原文: [https://ithelp.ithome.com.tw/articles/10227039](https://ithelp.ithome.com.tw/articles/10227039)

### 前情提要

------------------------------------------------------------------------

昨日進入 `minit` 之後再進到 `minitSignals`，看完了針對 signal 使用的堆疊如何設置。

#### 開始 `minitSignalMask`

```go
func minitSignalMask() {    
        nmask := getg().m.sigmask
        for i := range sigtable {
                if !blockableSig(uint32(i)) {                            
                        sigdelset(&nmask, i)
                }           
        }                   
        sigprocmask(_SIG_SETMASK, &nmask, nil)
}

```
從當前 goroutine 所屬的 thread（M）當中取得 `sigmask` 成員的內容這個動作，意味著存取先前存下來的 mask。我們正在初始化的這個階段，拿到的 `nmask` 內容全部都是零。另一個有趣的內容是 `sigtable` 陣列，裡面有 GO 語言重新包裝 signal 的方法，列舉一些例子如下：

```go
var sigtable = [...]sigTabT{        
        /*  0 */ {0, "SIGNONE: no trap"},
        /*  1 */ {_SigNotify + _SigKill, "SIGHUP: terminal line hangup"},
        /*  2 */ {_SigNotify + _SigKill, "SIGINT: interrupt"},
        /*  3 */ {_SigNotify + _SigThrow, "SIGQUIT: quit"},
        /*  4 */ {_SigThrow + _SigUnblock, "SIGILL: illegal instruction"},
        /*  5 */ {_SigThrow + _SigUnblock, "SIGTRAP: trace trap"},
        /*  6 */ {_SigNotify + _SigThrow, "SIGABRT: abort"},
...

```
將原本的 Unix signal 拆解、重新定義成 signal handler 處理時的參考，應該也算是一種創舉吧？ `blockableSig` 函式的判斷內容如下：

```go
func blockableSig(sig uint32) bool {
        flags := sigtable[sig].flags
        if flags&_SigUnblock != 0 {
                return false
        }              
        if isarchive || islibrary {
                return true
        }              
        return flags&(_SigKill|_SigThrow) == 0
}

```
也就是說，要是

1.  `flags` 當中包含了 `_SigUnblock`，就立刻表明這個 signal 是不可以被 mask 阻擋的。這些 signal 都是同步的（synchrounous，跟隨當前的 執行緒一起執行卻出了狀況所發出的 signal，如上面列表的 SIGILL 與 SIGTRAP），而且以 GO 語言的處理方法來講會使之成為 panic。
2.  可是要是現在是作為靜態或動態函式庫被引用的話，就還是回傳為可阻擋的。這是為了給呼叫 GO 程式的 C 程式較大的決定權。
3.  回傳是否不含 `_SigKill` 或是 `_SigThrow`。

如果是不可阻擋的那些 signal 都會進入 `sigdelset` 函式，將那些 signal 自 mask 中註銷掉。跑完迴圈之後，`sigprocmask` 將處理好的 `nmask` 設為所需使用的 signal mask，然後繼續。

#### 回到 `mstart1` 函式

```go
        // Install signal handlers; after minit so that minit can
        // prepare the thread to be able to handle the signals.
        if _g_.m == &m0 {
                mstartm0()
        }

```
在當前的 goroutine 的所屬執行緒是 `m0` 的情況下進入 `mstartm0` 函式，正式啟用在此之前的 signal 處理設定，其中最關鍵的是 `initsig` 函式

```go
func mstartm0() {
    ...
        initsig(false)
}

...

func initsig(preinit bool) {
        if !preinit {     
                // It's now OK for signal handlers to run.
                signalsOK = true
        }                 
                          
        // For c-archive/c-shared this is called by libpreinit with
        // preinit == true.
        if (isarchive || islibrary) && !preinit {
                return    
        }

```
`preinit` 在這裡是一個幫助我們理解的關鍵字，代表我們是否正透過 `libpreinit` 函式呼叫來執行。這裡顯然不是，所以傳入的參數是否的布林值。然而，在 GO 程式被編譯成函式庫型態的時候（`-buildmode=c-archive` 或 `-buildmode=c-shared`），`runtime/asm_amd64.s` 中的 `_rt0_amd64_lib` 函式就會被作為全域的建構子被呼叫，裡面會呼叫到 `initsig(true)`。無論如何，這裡我們只會進入第一個判斷式，將 `signalOK` 設起來。

```go
        for i := uint32(0); i < _NSIG; i++ {
                t := &sigtable[i]
                fwdSig[i] = getsig(i)
        
                if !sigInstallGoHandler(i) {
            ...
                        continue
                }
        
                handlingSig[i] = 1
                setsig(i, funcPC(sighandler))
        }
}

```
這個迴圈一樣會跑過所有 signal。`fwdSig` 是一個陣列，紀錄現在的 GO 程式控制 signal 的策略（fwd 本身是 forward 的意思）；它所賦值的來源 `getsig` 函式會使用 `sigaction` 系統呼叫，取得指定的 signal 的相關設定。中段的判斷部份在處理是否要為了這個 signal 自行安裝 handler，但是現在的初始狀況完全不會進到這個部份。`handlingSig` 陣列用來紀錄每一個 signal 是否正在使用 GO 語言的 handler，之後的執行中有一些場合（如 disable signal）會將這個值設成 0。最後的 `setsig` 函式，也使用了 `sigaction` 設定目前為止的配置到核心裡面。

> 看起來會用到 `sigtramp` 與 `sigreturn` 兩個函式。關於 `sighandler` 的詳細運作，有機會再追蹤進去。

#### 再次回到 `mstart1` 函式

```go
        if fn := _g_.m.mstartfn; fn != nil {
                fn()        
        }
                                                                           
        if _g_.m != &m0 {
                acquirep(_g_.m.nextp.ptr())
                _g_.m.nextp = 0
        }
        schedule()

```
再來是如果所屬的執行緒有合法的 `mstartfn` 成員的話，就執行 `fn` 函式。下面的判斷式則是與前一段相反，必須不是系統初始執行緒才會進來作。我們現在的初始化情況，這兩個判斷都不會生效，於是直接進入 `schedule` 函式。

### 疑問

------------------------------------------------------------------------

- 接收到 signal 的時候，GO 語言的處理方式是？

### 本日小結

------------------------------------------------------------------------

今日簡單瀏覽一下最後一部份的 signal setup，看到 GO 語言如何管理不同的 signal，以及相當重視與 C 語言之間的界面。
